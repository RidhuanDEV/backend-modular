package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/redis/go-redis/v9"
)

func testConfig() config.Config {
	return config.Config{JWTSecret: "a_very_long_test_secret_at_least_32_chars", RefreshIdleDays: 30, RefreshAbsoluteDays: 90, Rates: map[string]config.Rate{"auth": {WindowMS: 900000, Max: 20}, "public": {WindowMS: 900000, Max: 100}, "internal": {WindowMS: 900000, Max: 300}}, Policies: map[string]config.PolicyOverride{}, CORSOrigins: map[string]struct{}{"http://localhost:5173": {}}, RateStore: "memory"}
}

func TestRegistryAndOpenAPI(t *testing.T) {
	c := testConfig()
	server, err := newTestServer(c, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if got := len(server.registered); got != len(Definitions) {
		t.Fatalf("mounted %d endpoints, want %d", got, len(Definitions))
	}
	req := httptest.NewRequest(http.MethodGet, "/docs/openapi.json", nil)
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("openapi status %d: %s", rec.Code, rec.Body.String())
	}
	var document struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, methods := range document.Paths {
		for _, op := range methods {
			if op.OperationID != "" {
				count++
			}
		}
	}
	if count != len(Definitions) {
		t.Fatalf("OpenAPI documented %d operations, want %d", count, len(Definitions))
	}
	for _, ep := range Definitions {
		if ep.ID == "ready.get" {
			continue
		}
		path := strings.ReplaceAll(ep.Path, "{id}", "00000000-0000-4000-8000-000000000001")
		path = strings.ReplaceAll(path, "{module}", "auth")
		req := httptest.NewRequest(ep.Method, path, nil)
		response := httptest.NewRecorder()
		server.Router.ServeHTTP(response, req)
		expected := 401
		if ep.Public {
			expected = ep.Status
			if ep.ID == "auth.register" || ep.ID == "auth.login" || ep.ID == "auth.refresh" || ep.ID == "auth.logout" {
				expected = 400
			}
		}
		if response.Code != expected {
			t.Fatalf("%s %s (%s) returned %d, want %d", ep.Method, path, ep.ID, response.Code, expected)
		}
	}
}

func TestLiveCORS(t *testing.T) {
	c := testConfig()
	server, err := newTestServer(c, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ origin, expected string }{{"http://localhost:5173", "http://localhost:5173"}, {"https://other.example", ""}, {"", ""}} {
		req := httptest.NewRequest(http.MethodGet, "/live", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		rec := httptest.NewRecorder()
		server.Router.ServeHTTP(rec, req)
		if rec.Code != 200 || rec.Header().Get("Access-Control-Allow-Origin") != tc.expected {
			t.Fatalf("origin %q: status %d, allow %q", tc.origin, rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
		}
	}
}

func TestUnknownPolicyRejected(t *testing.T) {
	c := testConfig()
	c.Policies["missing.endpoint"] = config.PolicyOverride{Audit: "none"}
	if _, err := Resolve(c); err == nil {
		t.Fatal("unknown endpoint policy accepted")
	}
}

func TestAuditCapabilityOverrides(t *testing.T) {
	for _, item := range []struct {
		endpoint, mode string
		valid          bool
	}{
		{"user.get", "required", false}, {"notification.stream", "optional", false},
		{"auth.refresh", "required", true}, {"auth.logout", "required", true},
	} {
		t.Run(item.endpoint+item.mode, func(t *testing.T) {
			c := testConfig()
			c.Policies[item.endpoint] = config.PolicyOverride{Audit: item.mode}
			_, err := Resolve(c)
			if (err == nil) != item.valid {
				t.Fatalf("expected accepted=%v, got %v", item.valid, err)
			}
		})
	}
}

func TestRedisRateFailureClosesAuthAndOpensPublic(t *testing.T) {
	c := testConfig()
	c.RateStore = "redis"
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", DialTimeout: 10 * time.Millisecond, MaxRetries: 0})
	defer client.Close()
	server, err := newTestServer(c, nil, client, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	auth := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	authResponse := httptest.NewRecorder()
	server.Router.ServeHTTP(authResponse, auth)
	if authResponse.Code != 503 {
		t.Fatalf("auth rate store failure status %d", authResponse.Code)
	}
	docs := httptest.NewRequest(http.MethodGet, "/docs/openapi.json", nil)
	docsResponse := httptest.NewRecorder()
	server.Router.ServeHTTP(docsResponse, docs)
	if docsResponse.Code != 200 {
		t.Fatalf("public fail-open status %d", docsResponse.Code)
	}
}

func TestOpenAPIDocumentsRefreshCookieTransport(t *testing.T) {
	server, err := newTestServer(testConfig(), nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs/openapi.json", nil))
	var document struct {
		Paths map[string]map[string]struct {
			Description string `json:"description"`
			Parameters  []struct {
				Name     string `json:"name"`
				In       string `json:"in"`
				Required bool   `json:"required"`
			} `json:"parameters"`
			Responses map[string]struct {
				Headers map[string]json.RawMessage `json:"headers"`
			} `json:"responses"`
		} `json:"paths"`
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	for path, status := range map[string]string{"/api/auth/login": "200", "/api/auth/refresh": "200", "/api/auth/logout": "204"} {
		op := document.Paths[path]["post"]
		if !strings.Contains(op.Description, "REFRESH_TOKEN_TRANSPORT") {
			t.Fatalf("%s lacks cookie mode description", path)
		}
		if op.Responses[status].Headers["Set-Cookie"] == nil {
			t.Fatalf("%s %s lacks Set-Cookie header", path, status)
		}
		found := false
		for _, p := range op.Parameters {
			if p.Name == "X-Requested-With" && p.In == "header" && !p.Required {
				found = true
			}
		}
		if found != (path != "/api/auth/login") {
			t.Fatalf("%s X-Requested-With documented=%v", path, found)
		}
		for _, code := range []string{"400", "403"} {
			if path != "/api/auth/login" {
				if _, ok := op.Responses[code]; !ok {
					t.Fatalf("%s lacks %s", path, code)
				}
			}
		}
	}
}

func TestDocsTrailingSlashRedirects(t *testing.T) {
	server, err := newTestServer(testConfig(), nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{"/docs/": "/docs", "/docs/?x=1": "/docs?x=1"} {
		rec := httptest.NewRecorder()
		server.Router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != want {
			t.Fatalf("%s -> %d %q", path, rec.Code, rec.Header().Get("Location"))
		}
	}
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/docs -> %d", rec.Code)
	}
	disabled := testConfig()
	disabled.DocsDisabled = true
	server, err = newTestServer(disabled, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	server.Router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs/", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("disabled /docs/ -> %d", rec.Code)
	}
}

func TestOpenAPIErrorsFollowPipeline(t *testing.T) {
	server, err := newTestServer(testConfig(), nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	server.Router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/docs/openapi.json", nil))
	var document struct {
		Paths map[string]map[string]struct {
			Responses map[string]json.RawMessage `json:"responses"`
		} `json:"paths"`
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &document); err != nil {
		t.Fatal(err)
	}
	codes := func(path, method string) map[string]bool {
		out := map[string]bool{}
		for code := range document.Paths[path][method].Responses {
			out[code] = true
		}
		return out
	}
	for path, want := range map[string]map[string]bool{
		"/ready": {"200": true, "500": true, "503": true},
		"/live":  {"200": true, "500": true},
	} {
		got := codes(path, "get")
		if len(got) != len(want) {
			t.Fatalf("%s documents %v, want %v", path, got, want)
		}
	}
	users := codes("/api/users", "get")
	for _, code := range []string{"400", "401", "403", "429", "500"} {
		if !users[code] {
			t.Fatalf("/api/users lacks %s", code)
		}
	}
	for _, code := range []string{"404", "409", "413", "503"} {
		if users[code] {
			t.Fatalf("/api/users documents %s", code)
		}
	}
	if !codes("/api/users/{id}", "get")["404"] || !codes("/api/auth/login", "post")["503"] || codes("/api/auth/login", "post")["403"] {
		t.Fatal("path lookup, auth rate store or login permission errors are wrong")
	}
}
