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
	return config.Config{JWTSecret: "a_very_long_test_secret_at_least_32_chars", Rates: map[string]config.Rate{"auth": {WindowMS: 900000, Max: 20}, "public": {WindowMS: 900000, Max: 100}, "internal": {WindowMS: 900000, Max: 300}}, Policies: map[string]config.PolicyOverride{}, CORSOrigins: map[string]struct{}{"http://localhost:5173": {}}, RateStore: "memory"}
}

func TestRegistryAndOpenAPI(t *testing.T) {
	c := testConfig()
	server, err := newTestServer(c, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if got := len(server.registered); got != 28 {
		t.Fatalf("mounted %d endpoints, want 28", got)
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
	if count != 28 {
		t.Fatalf("OpenAPI documented %d operations, want 28", count)
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
			if ep.ID == "auth.register" || ep.ID == "auth.login" || ep.ID == "auth.refresh" {
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
