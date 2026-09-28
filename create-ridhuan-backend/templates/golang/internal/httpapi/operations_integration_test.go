package httpapi

import (
	"bytes"
	"context"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/db/sqlc"
	"github.com/google/uuid"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestUploadSignatureSizeAndMissingFile(t *testing.T) {
	s, pool, token := integrationServer(t)
	for _, tc := range []struct {
		name   string
		data   []byte
		status int
	}{{"valid", []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, 201}, {"forged", []byte("not a PNG"), 400}, {"oversize", append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 1024)...), 413}, {"missing", nil, 400}} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			if tc.data != nil {
				part, err := writer.CreateFormFile("file", "sample.png")
				if err != nil {
					t.Fatal(err)
				}
				if _, err = part.Write(tc.data); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/api/upload", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.Header.Set("Authorization", "Bearer "+token)
			out := httptest.NewRecorder()
			s.Router.ServeHTTP(out, req)
			if out.Code != tc.status {
				t.Fatalf("%d want %d %s", out.Code, tc.status, out.Body.String())
			}
			if tc.status == 201 {
				assertExpressShape(t, "upload.create", out)
				file := decodeBody[StoredFile](t, out)
				assertExpressShape(t, "upload.get", call(t, s, "GET", "/api/upload/"+file.ID, token, nil, 200))
				t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM stored_files WHERE id=$1", file.ID) })
			}
		})
	}
}
func TestConcurrentUserUpdatesHaveConsistentSnapshots(t *testing.T) {
	s, pool, _ := integrationServer(t)
	q := sqlc.New(pool)
	r, err := q.FindRoleByName(t.Context(), "user")
	if err != nil {
		t.Fatal(err)
	}
	initial := uuid.NewString() + "@example.test"
	u, err := q.CreateUser(t.Context(), sqlc.CreateUserParams{Lower: initial, Password: "unused-in-this-test", RoleID: r.ID})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE id=$1", u.ID) })
	var group sync.WaitGroup
	start := make(chan struct{})
	failures := make(chan error, 2)
	for _, email := range []string{"a_" + initial, "b_" + initial} {
		group.Add(1)
		go func(email string) {
			defer group.Done()
			<-start
			_, err := s.Users.Update(t.Context(), audit.Policy{ID: "user.update", Module: "user", Mode: audit.Required}, nil, u.ID, UpdateUserBody{Email: &email})
			failures <- err
		}(email)
	}
	close(start)
	group.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	rows, err := pool.Query(t.Context(), "SELECT before->>'email',after->>'email' FROM activity_logs WHERE endpoint_id='user.update' AND entity_id=$1", u.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	edges := map[string]string{}
	for rows.Next() {
		var before, after string
		if err = rows.Scan(&before, &after); err != nil {
			t.Fatal(err)
		}
		edges[before] = after
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	final, err := q.FindUser(t.Context(), u.ID)
	if err != nil || len(edges) != 2 || edges[edges[initial]] != final.Email {
		t.Fatal("inconsistent audit chain", edges, final.Email, err)
	}
}
func TestCleanupToolDryRunAndApply(t *testing.T) {
	_, pool, _ := integrationServer(t)
	directory := t.TempDir()
	old := time.Now().Add(-2 * time.Hour)
	orphan, referenced, recent := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, name := range []string{orphan, referenced, recent} {
		path := filepath.Join(directory, name)
		if err := os.WriteFile(path, []byte("sample"), 0600); err != nil {
			t.Fatal(err)
		}
		if name != recent {
			if err := os.Chtimes(path, old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	file, err := sqlc.New(pool).CreateFile(t.Context(), sqlc.CreateFileParams{Storage: "local", ObjectKey: referenced, OriginalName: "sample", MimeType: "text/plain", Size: 6})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), "DELETE FROM stored_files WHERE id=$1", file.ID) })
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	run := func(args ...string) string {
		t.Helper()
		command := exec.CommandContext(t.Context(), "go", append([]string{"run", "./cmd/cleanup-uploads"}, args...)...)
		command.Dir = root
		command.Env = append(os.Environ(), "NODE_ENV=test", "JWT_SECRET=testing_secret_at_least_32_characters", "UPLOAD_STORAGE=local", "UPLOAD_ENABLED=true", "UPLOAD_LOCAL_DIR="+directory, "UPLOAD_ORPHAN_GRACE_HOURS=1", "CACHE_ENABLED=false", "RATE_LIMIT_STORE=memory", "APP_INSTANCE_COUNT=1")
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("cleanup tool: %v %s", err, output)
		}
		return string(output)
	}
	if output := run(); !strings.Contains(output, orphan) || strings.Contains(output, referenced) || strings.Contains(output, recent) {
		t.Fatal("wrong dry-run candidates", output)
	}
	if _, err = os.Stat(filepath.Join(directory, orphan)); err != nil {
		t.Fatal("dry run removed orphan", err)
	}
	run("--apply")
	if _, err = os.Stat(filepath.Join(directory, orphan)); !os.IsNotExist(err) {
		t.Fatal("apply did not remove orphan", err)
	}
	for _, name := range []string{referenced, recent} {
		if _, err = os.Stat(filepath.Join(directory, name)); err != nil {
			t.Fatal("cleanup removed protected file", name, err)
		}
	}
}
