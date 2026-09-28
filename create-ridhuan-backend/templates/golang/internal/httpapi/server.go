package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/app"
	"github.com/RidhuanDEV/golang-backend/internal/audit"
	"github.com/RidhuanDEV/golang-backend/internal/auth"
	"github.com/RidhuanDEV/golang-backend/internal/cache"
	"github.com/RidhuanDEV/golang-backend/internal/config"
	"github.com/RidhuanDEV/golang-backend/internal/ratelimit"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type requestIDKey struct{}
type statusWriter struct {
	http.ResponseWriter
	status     int
	wrote      bool
	endpointID string
	actorID    string
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *statusWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.status = status
	w.wrote = true
	w.ResponseWriter.WriteHeader(status)
}
func (w *statusWriter) Write(data []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func requestID(ctx context.Context) string { v, _ := ctx.Value(requestIDKey{}).(string); return v }

type Server struct {
	Config config.Config
	DB     *pgxpool.Pool
	Redis  *redis.Client
	app.Services
	Cache      *cache.Cache
	Limiter    *ratelimit.Limiter
	Policies   map[EndpointID]Endpoint
	Router     chi.Router
	Docs       huma.API
	registered map[EndpointID]struct{}
	Logger     *slog.Logger
}

func NewServer(c config.Config, pool *pgxpool.Pool, client *redis.Client, services app.Services, logger *slog.Logger) (*Server, error) {
	if services.Auth == nil || services.Users == nil || services.Roles == nil || services.Permissions == nil || services.Uploads == nil || services.Audit == nil || logger == nil {
		return nil, fmt.Errorf("HTTP dependencies are required")
	}
	policies, err := Resolve(c)
	if err != nil {
		return nil, err
	}
	r := chi.NewRouter()
	docsCfg := huma.DefaultConfig("Modular Go Backend", "1.0.0")
	docsCfg.OpenAPIPath = ""
	docsCfg.DocsPath = ""
	docsCfg.SchemasPath = ""
	docsCfg.CreateHooks = nil
	docsCfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{"bearer": {Type: "http", Scheme: "bearer", BearerFormat: "JWT"}}
	s := &Server{Config: c, DB: pool, Redis: client, Services: services, Cache: cache.New(client, c.CacheEnabled), Limiter: ratelimit.New(func() *redis.Client {
		if c.RateStore == "redis" {
			return client
		}
		return nil
	}()), Policies: policies, Router: r, Docs: humachi.New(r, docsCfg), registered: map[EndpointID]struct{}{}, Logger: logger}
	r.Use(s.middleware)
	s.mount()
	if len(s.registered) != len(Definitions) {
		return nil, fmt.Errorf("registry coverage: mounted %d of %d endpoints", len(s.registered), len(Definitions))
	}
	return s, nil
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		tracked := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		id := r.Header.Get("X-Request-ID")
		if id == "" || len(id) > 128 {
			random := make([]byte, 16)
			if _, err := rand.Read(random); err == nil {
				id = hex.EncodeToString(random)
			} else {
				id = fmt.Sprintf("%d", time.Now().UnixNano())
			}
		}
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if origin := r.Header.Get("Origin"); origin != "" {
			if _, ok := s.Config.CORSOrigins[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			if recovered := recover(); recovered != nil {
				s.Logger.Error("panic recovered", "error", recovered, "requestId", id)
				writeError(tracked, internal())
			}
			s.Logger.Info("http request", "method", r.Method, "path", r.URL.Path, "status", tracked.status, "endpointId", tracked.endpointID, "actorId", tracked.actorID, "requestId", id, "durationMs", time.Since(start).Milliseconds())
		}()
		bounded, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		next.ServeHTTP(tracked, r.WithContext(context.WithValue(bounded, requestIDKey{}, id)))
	})
}
func (s *Server) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if s.Config.TrustProxyHops > 0 {
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if len(parts) >= s.Config.TrustProxyHops {
			candidate := strings.TrimSpace(parts[len(parts)-s.Config.TrustProxyHops])
			if parsed := net.ParseIP(candidate); parsed != nil {
				return parsed.String()
			}
		}
	}
	return host
}

type Actor = auth.Actor

func (s *Server) policy(ctx context.Context, id EndpointID) audit.Policy {
	ep := s.Policies[id]
	return audit.Policy{ID: string(id), Module: ep.Module, Mode: audit.Mode(ep.Audit), RequestID: requestID(ctx)}
}
