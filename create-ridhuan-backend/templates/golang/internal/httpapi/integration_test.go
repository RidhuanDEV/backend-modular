package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/storage"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

func TestPostgresContract(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL is not set")
	}
	if err := db.MigrateTo(url, 1); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, name := range []string{"admin", "user"} {
		if _, err = pool.Exec(ctx, `INSERT INTO roles(name) VALUES($1) ON CONFLICT DO NOTHING`, name); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"manage_users", "manage_roles", "manage_permissions"} {
		if _, err = pool.Exec(ctx, `INSERT INTO permissions(name) VALUES($1) ON CONFLICT DO NOTHING`, name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(ctx, `INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='admin' ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if err = db.Migrate(url); err != nil {
		t.Fatalf("upgrade from initial migration: %v", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte("test_password_123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(email,password,role_id) SELECT 'contract-admin@example.test',$1,id FROM roles WHERE name='admin' ON CONFLICT(email) DO UPDATE SET password=EXCLUDED.password,deleted_at=NULL`, string(hash)); err != nil {
		t.Fatal(err)
	}
	c := testConfig()
	c.UploadEnabled = true
	c.UploadStorage = "local"
	c.UploadMaxBytes = 1 << 20
	c.UploadAllowedMIME = map[string]struct{}{"image/png": {}}
	fileStore, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := newTestServer(c, pool, nil, fileStore, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	cacheOnly := c
	cacheOnly.CacheEnabled = true
	unreachable := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 10 * time.Millisecond, MaxRetries: 0})
	defer unreachable.Close()
	cacheServer, err := newTestServer(cacheOnly, pool, unreachable, fileStore, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	cacheReady := httptest.NewRecorder()
	cacheServer.Router.ServeHTTP(cacheReady, httptest.NewRequest("GET", "/ready", nil))
	if cacheReady.Code != 200 {
		t.Fatalf("cache-only Redis outage blocked readiness: %d", cacheReady.Code)
	}
	request := func(method, path, token string, body any) *httptest.ResponseRecorder {
		t.Helper()
		var reader io.Reader
		if body != nil {
			data, e := json.Marshal(body)
			if e != nil {
				t.Fatal(e)
			}
			reader = bytes.NewReader(data)
		}
		req := httptest.NewRequest(method, path, reader)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		server.Router.ServeHTTP(rec, req)
		return rec
	}
	login := request("POST", "/api/auth/login", "", map[string]string{"email": "contract-admin@example.test", "password": "test_password_123"})
	if login.Code != 200 {
		t.Fatalf("login %d %s", login.Code, login.Body.String())
	}
	var loginBody Success[Token]
	if err = json.Unmarshal(login.Body.Bytes(), &loginBody); err != nil {
		t.Fatal(err)
	}
	token := loginBody.Data.Token
	if rec := request("GET", "/api/users", "", nil); rec.Code != 401 {
		t.Fatalf("unauthenticated list status %d", rec.Code)
	}
	name := "contract_test_role_" + time.Now().Format("150405")
	created := request("POST", "/api/roles", token, map[string]string{"name": name})
	if created.Code != 201 {
		t.Fatalf("role create %d %s", created.Code, created.Body.String())
	}
	var roleBody Success[Role]
	if err = json.Unmarshal(created.Body.Bytes(), &roleBody); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM roles WHERE id=$1::uuid`, roleBody.Data.ID)
	}()
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM activity_logs WHERE endpoint_id='role.create' AND entity_id=$1`, roleBody.Data.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("required audit count %d: %v", count, err)
	}
	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	part, err := writer.CreateFormFile("file", "sample.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00}); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest := httptest.NewRequest("POST", "/api/upload", &uploadBody)
	uploadRequest.Header.Set("Content-Type", writer.FormDataContentType())
	uploadRequest.Header.Set("Authorization", "Bearer "+token)
	uploadResponse := httptest.NewRecorder()
	server.Router.ServeHTTP(uploadResponse, uploadRequest)
	if uploadResponse.Code != 201 {
		t.Fatalf("upload %d %s", uploadResponse.Code, uploadResponse.Body.String())
	}
	var uploaded Success[StoredFile]
	if err = json.Unmarshal(uploadResponse.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	metadata := request("GET", "/api/upload/"+uploaded.Data.ID, token, nil)
	if metadata.Code != 200 {
		t.Fatalf("upload metadata %d: %s", metadata.Code, metadata.Body.String())
	}
	if _, err = pool.Exec(ctx, `CREATE OR REPLACE FUNCTION reject_contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.endpoint_id IN ('permission.create','auth.login') THEN RAISE EXCEPTION 'audit blocked by test'; END IF; RETURN NEW; END $$`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `CREATE TRIGGER reject_contract_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_contract_audit()`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS reject_contract_audit ON activity_logs`)
		_, _ = pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS reject_contract_audit()`)
	}()
	blockedName := "contract_blocked_" + time.Now().Format("150405")
	blocked := request("POST", "/api/permissions", token, map[string]string{"name": blockedName})
	if blocked.Code != 500 {
		t.Fatalf("expected audit rollback status 500, got %d: %s", blocked.Code, blocked.Body.String())
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM permissions WHERE name=$1`, blockedName).Scan(&count); err != nil || count != 0 {
		t.Fatalf("mutation persisted without required audit: %d %v", count, err)
	}
	requiredLogin := server.Policies["auth.login"]
	requiredLogin.Audit = AuditRequired
	requiredToken, loginError := server.Auth.Login(ctx, audit.Policy{ID: string(requiredLogin.ID), Module: requiredLogin.Module, Mode: audit.Required}, Credentials{Email: "contract-admin@example.test", Password: "test_password_123"})
	if loginError == nil || requiredToken.AccessToken != "" {
		t.Fatal("required login audit failed but token was returned")
	}
	if err = db.Migrate(url); err != nil {
		t.Fatalf("idempotent migrate: %v", err)
	}
	var existing string
	if err = pool.QueryRow(ctx, `SELECT name FROM roles WHERE id=$1::uuid`, roleBody.Data.ID).Scan(&existing); err != nil || existing != name {
		t.Fatalf("data lost after migration: %q %v", existing, err)
	}
}
