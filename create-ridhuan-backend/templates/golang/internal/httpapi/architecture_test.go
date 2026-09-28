package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func integrationServer(t *testing.T) (*Server, *pgxpool.Pool, string) {
	t.Helper()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL is not set")
	}
	if err := db.Migrate(url); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(t.Context(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	q := sqlc.New(pool)
	for _, name := range []string{"admin", "user"} {
		if err = q.SeedRole(t.Context(), name); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"manage_users", "manage_roles", "manage_permissions"} {
		if err = q.SeedPermission(t.Context(), name); err != nil {
			t.Fatal(err)
		}
	}
	if err = q.SeedAdminPermissions(t.Context()); err != nil {
		t.Fatal(err)
	}
	r, err := q.FindRoleByName(t.Context(), "admin")
	if err != nil {
		t.Fatal(err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("fixture_password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	u, err := q.CreateUser(t.Context(), sqlc.CreateUserParams{Lower: uuid.NewString() + "@example.test", Password: string(hash), RoleID: r.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", u.ID) })
	c := testConfig()
	c.UploadEnabled = true
	c.UploadStorage = "local"
	c.UploadMaxBytes = 1024
	c.UploadAllowedMIME = map[string]struct{}{"image/png": {}}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := newTestServer(c, pool, nil, store, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	login := call(t, server, "POST", "/api/auth/login", "", map[string]string{"email": u.Email, "password": "fixture_password"}, 200)
	token := decodeBody[Token](t, login).Token
	return server, pool, token
}
func call(t *testing.T, s *Server, method, path, token string, body any, status int) *httptest.ResponseRecorder {
	t.Helper()
	var source io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		source = bytes.NewReader(data)
	}
	request := httptest.NewRequest(method, path, source)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	out := httptest.NewRecorder()
	s.Router.ServeHTTP(out, request)
	if out.Code != status {
		t.Fatalf("%s %s: %d want %d: %s", method, path, out.Code, status, out.Body.String())
	}
	if status == 204 && out.Body.Len() != 0 {
		t.Fatal("204 response has a body")
	}
	if status >= 400 {
		var failure Failure
		if err := json.Unmarshal(out.Body.Bytes(), &failure); err != nil || failure.Success || failure.Message == "" || failure.Errors == nil {
			t.Fatalf("invalid failure envelope: %s", out.Body.String())
		}
	}
	return out
}
func decodeBody[T any](t *testing.T, r *httptest.ResponseRecorder) T {
	t.Helper()
	var response Success[T]
	if err := json.Unmarshal(r.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !response.Success {
		t.Fatal("unsuccessful response")
	}
	return response.Data
}

// This guards wire shape/type/nullability against the source Zod snapshot.
// JS regex validation is tested by explicit runtime invalid-input cases instead.
func assertExpressShape(t *testing.T, id string, response *httptest.ResponseRecorder) {
	t.Helper()
	fixturePath := "../../contracts/express-schemas.json"
	if id == "auth.register" || id == "auth.login" || id == "auth.refresh" || id == "auth.me" {
		fixturePath = "../../contracts/go-auth-schemas.json"
	}
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Endpoints []struct {
			ID       string       `json:"id"`
			Response *huma.Schema `json:"response"`
		} `json:"endpoints"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	var schema *huma.Schema
	for _, endpoint := range fixture.Endpoints {
		if endpoint.ID == id {
			schema = endpoint.Response
			break
		}
	}
	if schema == nil {
		t.Fatalf("missing response fixture %s", id)
	}
	var shape func(*huma.Schema)
	shape = func(s *huma.Schema) {
		if s == nil {
			return
		}
		s.Pattern = ""
		for _, v := range s.Properties {
			shape(v)
		}
		shape(s.Items)
		for _, v := range s.AnyOf {
			shape(v)
		}
		for _, v := range s.OneOf {
			shape(v)
		}
		for _, v := range s.AllOf {
			shape(v)
		}
	}
	shape(schema)
	schema.PrecomputeMessages()
	var value any
	if err = json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	result := &huma.ValidateResult{}
	huma.Validate(huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer), schema, huma.NewPathBuffer(nil, 0), huma.ModeReadFromServer, value, result)
	if len(result.Errors) > 0 {
		t.Fatalf("%s violates Express wire shape: %v; %s", id, result.Errors, response.Body.String())
	}
}
func TestFeatureCRUDAndExpressWireShapes(t *testing.T) {
	s, pool, token := integrationServer(t)
	suffix := uuid.NewString()[:8]
	roleCreate := call(t, s, "POST", "/api/roles", token, map[string]string{"name": "fixture_" + suffix}, 201)
	assertExpressShape(t, "role.create", roleCreate)
	r := decodeBody[Role](t, roleCreate)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM roles WHERE id=$1", r.ID) })
	for id, path := range map[string]string{"role.list": "/api/roles", "role.get": "/api/roles/" + r.ID, "permission.list": "/api/permissions", "auth.me": "/api/auth/me", "user.list": "/api/users"} {
		assertExpressShape(t, id, call(t, s, "GET", path, token, nil, 200))
	}
	call(t, s, "POST", "/api/roles", token, map[string]string{"name": "fixture_" + suffix}, 409)
	assertExpressShape(t, "role.update", call(t, s, "PATCH", "/api/roles/"+r.ID, token, map[string]string{}, 200))
	permissionCreate := call(t, s, "POST", "/api/permissions", token, map[string]string{"name": "fixture_" + suffix}, 201)
	assertExpressShape(t, "permission.create", permissionCreate)
	p := decodeBody[Permission](t, permissionCreate)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM permissions WHERE id=$1", p.ID) })
	assertExpressShape(t, "permission.get", call(t, s, "GET", "/api/permissions/"+p.ID, token, nil, 200))
	assertExpressShape(t, "permission.update", call(t, s, "PATCH", "/api/permissions/"+p.ID, token, map[string]string{"name": "changed_" + suffix}, 200))
	assertExpressShape(t, "role.assignPermissions", call(t, s, "POST", "/api/roles/"+r.ID+"/permissions", token, map[string][]string{"permissionIds": {p.ID, p.ID}}, 200))
	before, err := sqlc.New(pool).ListRolePermissionIDs(t.Context(), r.ID)
	if err != nil || len(before) != 1 {
		t.Fatal(before, err)
	}
	call(t, s, "POST", "/api/roles/"+r.ID+"/permissions", token, map[string][]string{"permissionIds": {uuid.NewString()}}, 400)
	after, err := sqlc.New(pool).ListRolePermissionIDs(t.Context(), r.ID)
	if err != nil || len(after) != 1 || after[0] != before[0] {
		t.Fatal("assignment was not rolled back", after, err)
	}
	email := suffix + "@example.test"
	created := call(t, s, "POST", "/api/users", token, map[string]string{"email": email, "password": "fixture_password", "roleId": r.ID}, 201)
	assertExpressShape(t, "user.create", created)
	u := decodeBody[User](t, created)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", u.ID) })
	call(t, s, "DELETE", "/api/roles/"+r.ID, token, nil, 400)
	assertExpressShape(t, "user.get", call(t, s, "GET", "/api/users/"+u.ID, token, nil, 200))
	assertExpressShape(t, "user.update", call(t, s, "PATCH", "/api/users/"+u.ID, token, map[string]string{"email": "updated_" + email}, 200))
	selected := call(t, s, "GET", "/api/users?fields=email&limit=1", token, nil, 200)
	var projection Success[[]map[string]json.RawMessage]
	if err = json.Unmarshal(selected.Body.Bytes(), &projection); err != nil || len(projection.Data) != 1 || len(projection.Data[0]) != 1 {
		t.Fatal("fields projection", selected.Body.String(), err)
	}
	call(t, s, "GET", "/api/users?fields=password", token, nil, 400)
	call(t, s, "GET", "/api/users?limit=1000", token, nil, 400)
	call(t, s, "GET", "/api/users?sortBy=email;DROP%20TABLE%20users", token, nil, 400)
	basic := call(t, s, "POST", "/api/auth/login", "", map[string]string{"email": "updated_" + email, "password": "fixture_password"}, 200)
	assertExpressShape(t, "auth.login", basic)
	basicToken := decodeBody[Token](t, basic).Token
	call(t, s, "GET", "/api/users", basicToken, nil, 403)
	call(t, s, "DELETE", "/api/users/"+u.ID, token, nil, 204)
	call(t, s, "GET", "/api/auth/me", basicToken, nil, 401)
	call(t, s, "GET", "/api/users/"+u.ID, token, nil, 404)
	call(t, s, "DELETE", "/api/roles/"+r.ID, token, nil, 400)
	if _, err = pool.Exec(t.Context(), "DELETE FROM users WHERE id=$1", u.ID); err != nil {
		t.Fatal(err)
	}
	call(t, s, "DELETE", "/api/roles/"+r.ID, token, nil, 204)
	call(t, s, "DELETE", "/api/permissions/"+p.ID, token, nil, 204)
	call(t, s, "GET", "/api/permissions/"+p.ID, token, nil, 404)
	registered := call(t, s, "POST", "/api/auth/register", "", map[string]string{"email": "registered_" + email, "password": "fixture_password"}, 201)
	assertExpressShape(t, "auth.register", registered)
	newUser := decodeBody[AuthUser](t, registered)
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", newUser.ID) })
	var timezone string
	if err = pool.QueryRow(t.Context(), "SHOW timezone").Scan(&timezone); err != nil || timezone != "UTC" {
		t.Fatal("database timezone", timezone, err)
	}
	var snapshot string
	if err = pool.QueryRow(t.Context(), "SELECT after::text FROM activity_logs WHERE endpoint_id='user.create' AND entity_id=$1", u.ID).Scan(&snapshot); err != nil || strings.Contains(snapshot, "password") {
		t.Fatal("unsafe audit snapshot", err)
	}
	var instant time.Time
	if err = pool.QueryRow(t.Context(), "SELECT created_at FROM users WHERE id=$1", newUser.ID).Scan(&instant); err != nil || instant.UTC().Format(time.RFC3339Nano) != newUser.CreatedAt.Format(time.RFC3339Nano) {
		t.Fatal("UTC roundtrip", err)
	}
}
func TestHumaRuntimeValidationAndRegistryGuards(t *testing.T) {
	s, err := newTestServer(testConfig(), nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []map[string]string{{"email": "bad", "password": "long_enough"}, {"email": "a@example.test", "password": "short"}, {"email": "a@example.test", "password": "long_enough", "unknown": "field"}} {
		call(t, s, "POST", "/api/auth/register", "", body, 400)
	}
	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email":"a@example.test","password":"x"} {}`))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	s.Router.ServeHTTP(response, req)
	if response.Code != 400 {
		t.Fatalf("trailing JSON %d", response.Code)
	}
	for _, policy := range []config.PolicyOverride{{Audit: "required"}, {Cache: "missing"}, {RateLimit: "missing"}} {
		c := testConfig()
		c.Policies["user.get"] = policy
		if _, err := Resolve(c); err == nil {
			t.Fatal("unsupported policy accepted", policy)
		}
	}
	original := Definitions
	defer func() { Definitions = original }()
	Definitions = append(append([]Endpoint{}, original...), original[0])
	if _, err = Resolve(testConfig()); err == nil {
		t.Fatal("duplicate registry accepted")
	}
	if validCachePayload[User](s, []byte(`{"success":true,"data":{}}`)) {
		t.Fatal("invalid cache DTO accepted")
	}
}
