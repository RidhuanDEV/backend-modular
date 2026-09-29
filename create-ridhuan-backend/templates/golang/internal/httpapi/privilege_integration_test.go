package httpapi

import (
	"context"
	"testing"

	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
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
