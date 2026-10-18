package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/role"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

func TestManagersCannotGrantPrivilegesTheyDoNotHold(t *testing.T) {
	server, pool, _ := integrationServer(t)
	ctx := t.Context()
	q := sqlc.New(pool)
	suffix := uuid.NewString()
	managerRole, err := q.CreateRole(ctx, "priv_manager_"+suffix)
	if err != nil {
		t.Fatal(err)
	}
	plainRole, err := q.CreateRole(ctx, "priv_plain_"+suffix)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE role_id = ANY($1)", []string{managerRole.ID, plainRole.ID})
		_, _ = pool.Exec(context.Background(), "DELETE FROM roles WHERE id = ANY($1)", []string{managerRole.ID, plainRole.ID})
	})
	permissionIDs := map[string]string{}
	for _, name := range []string{"manage_users", "manage_roles", "manage_permissions"} {
		var id string
		if err = pool.QueryRow(ctx, "SELECT id FROM permissions WHERE name=$1", name).Scan(&id); err != nil {
			t.Fatal(err)
		}
		permissionIDs[name] = id
	}
	for _, name := range []string{"manage_users", "manage_roles"} {
		if err = q.AssignRolePermission(ctx, sqlc.AssignRolePermissionParams{RoleID: managerRole.ID, PermissionID: permissionIDs[name]}); err != nil {
			t.Fatal(err)
		}
	}
	admin, err := q.FindRoleByName(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("manager_password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: "manager-" + suffix + "@example.test", Password: string(hash), RoleID: managerRole.ID})
	if err != nil {
		t.Fatal(err)
	}
	plain, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: "plain-" + suffix + "@example.test", Password: string(hash), RoleID: plainRole.ID})
	if err != nil {
		t.Fatal(err)
	}
	var adminUserID string
	if err = pool.QueryRow(ctx, "SELECT id FROM users WHERE role_id=$1 AND deleted_at IS NULL LIMIT 1", admin.ID).Scan(&adminUserID); err != nil {
		t.Fatal(err)
	}
	login := call(t, server, "POST", "/api/auth/login", "", map[string]string{"email": manager.Email, "password": "manager_password"}, 200)
	token := decodeBody[Token](t, login).Token

	call(t, server, "PATCH", "/api/users/"+plain.ID, token, map[string]string{"roleId": admin.ID}, 403)
	call(t, server, "POST", "/api/users", token, map[string]string{"email": "new-" + suffix + "@example.test", "password": "secret123", "roleId": admin.ID}, 403)
	call(t, server, "DELETE", "/api/users/"+adminUserID, token, nil, 403)
	all := []string{permissionIDs["manage_users"], permissionIDs["manage_roles"], permissionIDs["manage_permissions"]}
	call(t, server, "POST", "/api/roles/"+managerRole.ID+"/permissions", token, map[string][]string{"permissionIds": all}, 403)
	call(t, server, "PATCH", "/api/users/"+plain.ID, token, map[string]string{"roleId": managerRole.ID}, 200)
	call(t, server, "DELETE", "/api/users/"+plain.ID, token, nil, 204)
}

func TestSystemPermissionsCoverEveryEndpointPermission(t *testing.T) {
	for _, definition := range Definitions {
		if definition.Permission != "" && !slices.Contains(role.SystemPermissions, definition.Permission) {
			t.Errorf("endpoint %s uses %q, which is missing from role.SystemPermissions", definition.ID, definition.Permission)
		}
	}
}

func TestSystemPrimitivesLastRootSessionsAndFileOwnership(t *testing.T) {
	server, pool, token := integrationServer(t)
	ctx := t.Context()
	q := sqlc.New(pool)
	suffix := uuid.NewString()
	idOf := func(query, arg string) string {
		var id string
		if err := pool.QueryRow(ctx, query, arg).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	manageUsers := idOf("SELECT id FROM permissions WHERE name=$1", "manage_users")
	manageUploads := idOf("SELECT id FROM permissions WHERE name=$1", "manage_uploads")
	adminRole := idOf("SELECT id FROM roles WHERE name=$1", "admin")
	userRole := idOf("SELECT id FROM roles WHERE name=$1", "user")
	// RBAC only: a new permission is granted to every role managing permissions.
	custom := decodeBody[struct {
		ID string `json:"id"`
	}](t, call(t, server, "POST", "/api/permissions", token, map[string]string{"name": "custom_" + suffix}, 201))
	var granted int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM role_permissions WHERE role_id=$1 AND permission_id=$2", adminRole, custom.ID).Scan(&granted); err != nil || granted != 1 {
		t.Fatalf("new permission not granted to permission managers: %d %v", granted, err)
	}
	uploaderRole, err := q.CreateRole(ctx, "uploader_"+suffix)
	if err != nil {
		t.Fatal(err)
	}
	otherRole, err := q.CreateRole(ctx, "other_"+suffix)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, "DELETE FROM stored_files WHERE original_name=$1", "owned-"+suffix)
		_, _ = pool.Exec(bg, "DELETE FROM users WHERE role_id = ANY($1)", []string{uploaderRole.ID, otherRole.ID})
		_, _ = pool.Exec(bg, "DELETE FROM roles WHERE id = ANY($1)", []string{uploaderRole.ID, otherRole.ID})
		_, _ = pool.Exec(bg, "DELETE FROM permissions WHERE id=$1", custom.ID)
	})
	// F-01: system permissions are immutable and their names are reserved.
	call(t, server, "PATCH", "/api/permissions/"+manageUsers, token, map[string]string{"name": "x_" + suffix}, 403)
	call(t, server, "DELETE", "/api/permissions/"+manageUsers, token, nil, 403)
	call(t, server, "PATCH", "/api/permissions/"+custom.ID, token, map[string]string{"name": "manage_users"}, 403)
	call(t, server, "PATCH", "/api/permissions/"+custom.ID, token, map[string]string{"name": "renamed_" + suffix}, 200)
	// F-02: system roles keep their names, cannot be deleted; root keeps system permissions.
	call(t, server, "PATCH", "/api/roles/"+userRole, token, map[string]string{"name": "x_" + suffix}, 403)
	call(t, server, "DELETE", "/api/roles/"+userRole, token, nil, 403)
	call(t, server, "POST", "/api/roles", token, map[string]string{"name": "admin"}, 403)
	// F-07: files are readable by their uploader and root users only.
	me := decodeBody[struct {
		ID string `json:"id"`
	}](t, call(t, server, "GET", "/api/auth/me", token, nil, 200))
	if err = q.AssignRolePermission(ctx, sqlc.AssignRolePermissionParams{RoleID: uploaderRole.ID, PermissionID: manageUploads}); err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("member_password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	member, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: "member-" + suffix + "@example.test", Password: string(hash), RoleID: uploaderRole.ID})
	if err != nil {
		t.Fatal(err)
	}
	file, err := q.CreateFile(ctx, sqlc.CreateFileParams{Storage: "local", ObjectKey: uuid.NewString(), OriginalName: "owned-" + suffix, MimeType: "application/pdf", Size: 1, UploaderID: &me.ID})
	if err != nil {
		t.Fatal(err)
	}
	memberToken := decodeBody[Token](t, call(t, server, "POST", "/api/auth/login", "", map[string]string{"email": member.Email, "password": "member_password"}, 200)).Token
	call(t, server, "GET", "/api/upload/"+file.ID, memberToken, nil, 404)
	call(t, server, "GET", "/api/upload/"+file.ID, token, nil, 200)
	// F-10: a role change revokes the user's refresh sessions.
	call(t, server, "PATCH", "/api/users/"+member.ID, token, map[string]string{"roleId": otherRole.ID}, 200)
	var active int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM refresh_families WHERE user_id=$1 AND revoked_at IS NULL", member.ID).Scan(&active); err != nil || active != 0 {
		t.Fatalf("refresh families still active after role change: %d %v", active, err)
	}
	// F-09: no change may leave a system permission without an active holder,
	// whether by demoting the last holder or stripping the role's permissions.
	for _, change := range []string{
		"UPDATE users SET role_id='" + otherRole.ID + "' WHERE id='" + me.ID + "'",
		"DELETE FROM role_permissions WHERE role_id='" + adminRole + "' AND permission_id<>'" + custom.ID + "'",
	} {
		func() {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(context.Background()) }()
			if _, err = tx.Exec(ctx, "UPDATE users SET deleted_at=now() WHERE id<>$1 AND deleted_at IS NULL", me.ID); err != nil {
				t.Fatal(err)
			}
			holders, err := role.GuardSystemPermissionHolders(ctx, sqlc.New(tx))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, change); err != nil {
				t.Fatal(err)
			}
			if err = holders(); err == nil {
				t.Fatalf("lockout guard allowed %q", change)
			}
		}()
	}
}

func TestRefreshCookieTransport(t *testing.T) {
	server, pool, _ := integrationServer(t)
	server.Config.RefreshTransport = "cookie"
	server.Config.RefreshCookieName = "refresh_token"
	server.Config.RefreshCookieSameSite = http.SameSiteLaxMode
	ctx := t.Context()
	q := sqlc.New(pool)
	role, err := q.FindRoleByName(ctx, "user")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("cookie_password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	user, err := q.CreateUser(ctx, sqlc.CreateUserParams{Lower: "cookie-" + uuid.NewString() + "@example.test", Password: string(hash), RoleID: role.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", user.ID) })
	cookieOf := func(rec *httptest.ResponseRecorder) *http.Cookie {
		t.Helper()
		for _, cookie := range rec.Result().Cookies() {
			if cookie.Name == "refresh_token" {
				if !cookie.HttpOnly || cookie.Path != "/api/auth" || cookie.SameSite != http.SameSiteLaxMode {
					t.Fatalf("unsafe refresh cookie %+v", cookie)
				}
				return cookie
			}
		}
		t.Fatal("refresh cookie missing")
		return nil
	}
	send := func(path string, cookie *http.Cookie, header bool) *httptest.ResponseRecorder {
		request := httptest.NewRequest("POST", path, strings.NewReader("{}"))
		request.Header.Set("Content-Type", "application/json")
		if cookie != nil {
			request.AddCookie(cookie)
		}
		if header {
			request.Header.Set("X-Requested-With", "fetch")
		}
		out := httptest.NewRecorder()
		server.Router.ServeHTTP(out, request)
		return out
	}
	login := call(t, server, "POST", "/api/auth/login", "", map[string]string{"email": user.Email, "password": "cookie_password"}, 200)
	if decodeBody[Token](t, login).RefreshToken != "" {
		t.Fatal("refresh token leaked into the JSON body")
	}
	cookie := cookieOf(login)
	// Browsers attach cookies automatically, so a bare cross-site POST must fail.
	if out := send("/api/auth/refresh", cookie, false); out.Code != 403 {
		t.Fatalf("refresh without X-Requested-With: %d %s", out.Code, out.Body.String())
	}
	if out := send("/api/auth/refresh", nil, true); out.Code != 400 {
		t.Fatalf("refresh without token: %d %s", out.Code, out.Body.String())
	}
	refreshed := send("/api/auth/refresh", cookie, true)
	if refreshed.Code != 200 || decodeBody[Token](t, refreshed).RefreshToken != "" {
		t.Fatalf("cookie refresh: %d %s", refreshed.Code, refreshed.Body.String())
	}
	rotated := cookieOf(refreshed)
	if rotated.Value == cookie.Value {
		t.Fatal("refresh cookie was not rotated")
	}
	logout := send("/api/auth/logout", rotated, true)
	if logout.Code != 204 {
		t.Fatalf("cookie logout: %d %s", logout.Code, logout.Body.String())
	}
	if cleared := logout.Result().Cookies(); len(cleared) != 1 || cleared[0].MaxAge >= 0 {
		t.Fatalf("logout did not clear the cookie: %+v", cleared)
	}
	if out := send("/api/auth/refresh", rotated, true); out.Code != 401 {
		t.Fatalf("refresh after logout: %d", out.Code)
	}
}
