package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/db"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/RidhuanDEV/golang-backend/internal/upload"
	"github.com/redis/go-redis/v9"
	"io"
	"os"
	"testing"
	"time"
)

type compensationStore struct {
	putKey, deletedKey string
	cancel             context.CancelFunc
	failDelete         bool
	cleanupCanceled    bool
}

func (s *compensationStore) Put(_ context.Context, key string, source io.Reader) error {
	s.putKey = key
	if _, err := io.Copy(io.Discard, source); err != nil {
		return err
	}
	if s.cancel != nil {
		s.cancel()
	}
	return nil
}
func (s *compensationStore) Delete(ctx context.Context, key string) error {
	s.deletedKey = key
	s.cleanupCanceled = ctx.Err() != nil
	if s.failDelete {
		return errors.New("injected cleanup failure")
	}
	return nil
}
func TestUploadCompensationAndAuditFailure(t *testing.T) {
	s, pool, _ := integrationServer(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `CREATE OR REPLACE FUNCTION reject_upload_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.endpoint_id='upload.create' THEN RAISE EXCEPTION 'audit failure injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_upload_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION reject_upload_audit()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DROP TRIGGER IF EXISTS reject_upload_audit ON activity_logs; DROP FUNCTION IF EXISTS reject_upload_audit()")
	})
	for _, name := range []string{"required", "cleanup_failure", "canceled", "optional", "none"} {
		t.Run(name, func(t *testing.T) {
			store := &compensationStore{failDelete: name == "cleanup_failure"}
			service := *s.Uploads
			service.Storage = store
			request, cancel := context.WithCancel(ctx)
			defer cancel()
			if name == "canceled" {
				store.cancel = cancel
			}
			mode := audit.Required
			if name == "optional" {
				mode = audit.Optional
			}
			if name == "none" {
				mode = audit.None
			}
			data := []byte("sample")
			out, err := service.Create(request, audit.Policy{ID: "upload.create", Module: "upload", Mode: mode}, nil, upload.Input{Source: bytes.NewReader(data), Size: int64(len(data)), Name: "sample", MIME: "text/plain"})
			exists, lookupErr := sqlc.New(pool).FileReferenced(ctx, sqlc.FileReferencedParams{ObjectKey: store.putKey, Storage: "local"})
			if lookupErr != nil {
				t.Fatal(lookupErr)
			}
			if mode == audit.Required {
				if err == nil || exists || out.ID != "" || store.deletedKey != store.putKey || store.cleanupCanceled {
					t.Fatal("compensation violated", err, exists, store)
				}
			} else {
				if err != nil || !exists || store.deletedKey != "" {
					t.Fatal("optional/none mutation failed", out, err, store)
				}
				t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM stored_files WHERE id=$1", out.ID) })
			}
		})
	}
}
func TestCachedReadStillAuditsAndChecksCurrentGrants(t *testing.T) {
	url := os.Getenv("REDIS_URL")
	if url == "" {
		t.Skip("REDIS_URL is not set")
	}
	s, pool, token := integrationServer(t)
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(options)
	defer client.Close()
	c := s.Config
	c.CacheEnabled = true
	c.Policies["user.get"] = config.PolicyOverride{Audit: "optional"}
	cached, err := newTestServer(c, pool, client, s.Uploads.Storage, s.Logger)
	if err != nil {
		t.Fatal(err)
	}
	me := decodeBody[AuthUser](t, call(t, cached, "GET", "/api/auth/me", token, nil, 200))
	path := "/api/users/" + me.ID
	call(t, cached, "GET", path, token, nil, 200)
	call(t, cached, "GET", path, token, nil, 200)
	var count int
	if err = pool.QueryRow(t.Context(), "SELECT count(*) FROM activity_logs WHERE endpoint_id='user.get' AND entity_id=$1", me.ID).Scan(&count); err != nil || count != 2 {
		t.Fatal("cache hit missed read audit", count, err)
	}
	key, err := cached.Cache.Key(t.Context(), "user.get", me.ID, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = client.Set(t.Context(), key, `{"success":true,"data":{}}`, time.Minute).Err(); err != nil {
		t.Fatal(err)
	}
	response := call(t, cached, "GET", path, token, nil, 200)
	if decodeBody[User](t, response).ID != me.ID {
		t.Fatal("corrupt cache did not fall back")
	}
	// Change the user's role, leaving the cached authorized response in Redis.
	basic, err := sqlc.New(pool).FindRoleByName(t.Context(), "user")
	if err != nil {
		t.Fatal(err)
	}
	roleID := basic.ID
	if _, err = sqlc.New(pool).UpdateUser(t.Context(), sqlc.UpdateUserParams{ID: me.ID, RoleID: &roleID}); err != nil {
		t.Fatal(err)
	}
	call(t, cached, "GET", path, token, nil, 403)
	closedPool, err := db.Connect(t.Context(), os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	closedServer, err := newTestServer(c, closedPool, client, s.Uploads.Storage, s.Logger)
	if err != nil {
		t.Fatal(err)
	}
	closedPool.Close()
	call(t, closedServer, "GET", "/live", "", nil, 200)
	call(t, closedServer, "GET", "/ready", "", nil, 503)
}
func TestFailureEnvelopeDoesNotLeakCredentialValue(t *testing.T) {
	s, err := newTestServer(testConfig(), nil, nil, nil, testLogger())
	if err != nil {
		t.Fatal(err)
	}
	response := call(t, s, "POST", "/api/auth/register", "", map[string]string{"email": "bad", "password": "secret_password_value"}, 400)
	var value map[string]json.RawMessage
	if err = json.Unmarshal(response.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(response.Body.Bytes(), []byte("secret_password_value")) {
		t.Fatal("credential leaked")
	}
}
