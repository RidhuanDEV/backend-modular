package httpapi

import (
	"context"
	"encoding/json"
	"github.com/RidhuanDEV/golang-backend/internal/auth"
	"github.com/RidhuanDEV/golang-backend/internal/telemetry"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"net/http"
	"reflect"
	"strconv"
	"strings"
)

type actorKey struct{}
type requestKey struct{}
type output[T any] struct{ Body Success[T] }

func (s *Server) operation(id EndpointID) huma.Operation {
	ep, exists := s.Policies[id]
	if !exists {
		panic("unregistered endpoint: " + id)
	}
	if _, exists = s.registered[id]; exists {
		panic("duplicate endpoint: " + id)
	}
	s.registered[id] = struct{}{}
	op := huma.Operation{OperationID: string(id), Method: ep.Method, Path: ep.Path, Summary: ep.Summary, Tags: []string{ep.Module}, DefaultStatus: ep.Status, Errors: []int{400, 401, 403, 404, 409, 413, 429, 500, 503}, MaxBodyBytes: 1 << 20, Middlewares: huma.Middlewares{s.enforce(ep)}, Extensions: map[string]any{"x-audit-mode": ep.Audit, "x-rate-limit-group": ep.Rate, "x-cache-mode": ep.Cache}}
	if id == "upload.create" {
		op.MaxBodyBytes = s.Config.UploadMaxBytes + 1048576
	}
	if !ep.Public {
		op.Security = []map[string][]string{{"bearer": {}}}
	}
	if id == "auth.login" || id == "auth.refresh" || id == "auth.logout" {
		documentRefreshCookie(&op, id)
	}
	return op
}

const refreshCookieModes = "Refresh token transport is set by REFRESH_TOKEN_TRANSPORT. " +
	"body (default): the refresh token travels in JSON. " +
	"cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth and omit it from the response body; " +
	"refresh and logout read the cookie when the body has no refreshToken, and then require the X-Requested-With header (send credentials: \"include\" cross-origin). " +
	"A refreshToken in the body always takes precedence."

// documentRefreshCookie documents both refresh token transports on the endpoints that issue or consume it.
func documentRefreshCookie(op *huma.Operation, id EndpointID) {
	op.Description = refreshCookieModes
	cookie := "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)"
	if id == "auth.logout" {
		cookie = "Cookie mode only: clears the refresh cookie"
	}
	op.Responses = map[string]*huma.Response{
		strconv.Itoa(op.DefaultStatus): {Headers: map[string]*huma.Param{
			"Set-Cookie": {Description: cookie, Schema: &huma.Schema{Type: huma.TypeString}},
		}},
	}
	if id != "auth.login" {
		op.Parameters = append(op.Parameters, &huma.Param{
			Name: "X-Requested-With", In: "header", Required: false,
			Description: "Required (any value) when the refresh token comes from the cookie",
			Schema:      &huma.Schema{Type: huma.TypeString},
		})
	}
}
func (s *Server) enforce(ep Endpoint) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		ctx = huma.WithValue(ctx, telemetry.OperationKey{}, string(ep.ID))
		r, w := humachi.Unwrap(ctx)
		if tracked, ok := w.(*statusWriter); ok {
			tracked.endpointID = string(ep.ID)
		}
		// Verify the token without the database, throttle, then load the user:
		// rejected or throttled requests never reach a query.
		var claims *auth.Claims
		if !ep.Public {
			var err error
			claims, err = s.Auth.VerifyAccessToken(ctx.Header("Authorization"))
			if err != nil {
				writeError(w, err)
				return
			}
		}
		if ep.ID != "health.get" && ep.ID != "live.get" && ep.ID != "ready.get" {
			key := s.clientIP(r)
			if claims != nil && ep.Rate == RateInternal {
				key = claims.ID
			}
			allowed, err := s.Limiter.Allow(ctx.Context(), string(ep.Rate), key, s.Config.Rates[string(ep.Rate)])
			if err != nil {
				s.Logger.Warn("rate store unavailable", "endpoint", ep.ID, "error", err)
				if ep.Rate == RateAuth {
					writeError(w, &APIError{Status: 503, Message: "Rate limiter unavailable", Errors: []string{}})
					return
				}
			} else if !allowed {
				writeError(w, &APIError{Status: 429, Message: "Too many requests", Errors: []string{}})
				return
			}
		}
		var actor *Actor
		if claims != nil {
			var err error
			actor, err = s.Auth.LoadActor(ctx.Context(), claims)
			if err != nil {
				writeError(w, err)
				return
			}
			if err = s.Auth.Authorize(ctx.Context(), actor, ep.Permission); err != nil {
				writeError(w, err)
				return
			}
			if tracked, ok := w.(*statusWriter); ok {
				tracked.actorID = actor.ID
			}
		}
		if strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") == false && r.Body != http.NoBody && r.ContentLength != 0 && ep.ID != "upload.create" && ep.Method != http.MethodGet && ep.Method != http.MethodDelete {
			writeError(w, badRequest("Content-Type must be application/json"))
			return
		}
		ctx = huma.WithValue(ctx, actorKey{}, actor)
		ctx = huma.WithValue(ctx, requestKey{}, r)
		ctx = huma.WithValue(ctx, writerKey{}, w)
		next(ctx)
	}
}
func register[I, T any](s *Server, id EndpointID, handler func(context.Context, *I, *Actor) (Success[T], error)) {
	ep := s.Policies[id]
	op := s.operation(id)
	huma.Register(s.Docs, op, func(ctx context.Context, input *I) (*output[T], error) {
		actor, _ := ctx.Value(actorKey{}).(*Actor)
		r, _ := ctx.Value(requestKey{}).(*http.Request)
		cacheKey := ""
		if ep.Cache == CacheRead && ep.Method == http.MethodGet {
			who := "public"
			if actor != nil {
				who = actor.ID
			}
			var err error
			cacheKey, err = s.Cache.Key(ctx, string(id), who, r.URL.RequestURI())
			if err != nil {
				s.Logger.Warn("cache key unavailable", "error", err)
			} else if cacheKey != "" {
				data, err := s.Cache.Get(ctx, cacheKey)
				if err != nil {
					s.Logger.Warn("cache read unavailable", "error", err)
				} else if data != nil {
					var cached Success[T]
					if validCachePayload[T](s, data) && json.Unmarshal(data, &cached) == nil && cached.Success {
						s.Audit.Read(ctx, s.policy(ctx, id), actor, ctxEntityID(r))
						return &output[T]{Body: cached}, nil
					}
					s.Logger.Warn("invalid cache payload", "endpoint", id)
				}
			}
		}
		result, err := handler(ctx, input, actor)
		if err != nil {
			return nil, apiError(err)
		}
		if ep.Method != http.MethodGet {
			if err = s.Cache.Invalidate(ctx); err != nil {
				s.Logger.Warn("cache invalidation failed", "error", err)
			}
		}
		if ep.Status == 204 {
			return nil, nil
		}
		if cacheKey != "" {
			data, err := json.Marshal(result)
			if err == nil {
				err = s.Cache.Put(ctx, cacheKey, data)
			}
			if err != nil {
				s.Logger.Warn("cache write unavailable", "error", err)
			}
		}
		if ep.Method == http.MethodGet {
			s.Audit.Read(ctx, s.policy(ctx, id), actor, ctxEntityID(r))
		}
		return &output[T]{Body: result}, nil
	})
}

func validCachePayload[T any](s *Server, data []byte) bool {
	var value any
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	registry := s.Docs.OpenAPI().Components.Schemas
	schema := registry.Schema(reflect.TypeFor[Success[T]](), true, "")
	result := &huma.ValidateResult{}
	huma.Validate(registry, schema, huma.NewPathBuffer(nil, 0), huma.ModeReadFromServer, value, result)
	return len(result.Errors) == 0
}
func ctxEntityID(r *http.Request) string {
	parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
	if len(parts) > 0 && validUUID(parts[len(parts)-1]) == nil {
		return parts[len(parts)-1]
	}
	return ""
}

type rawOutput struct {
	ContentType string `header:"Content-Type"`
	Body        []byte
}

func raw[I any](s *Server, id EndpointID, handler func(context.Context, *I) (*rawOutput, error)) {
	huma.Register(s.Docs, s.operation(id), func(ctx context.Context, input *I) (*rawOutput, error) {
		out, err := handler(ctx, input)
		if err != nil {
			return nil, apiError(err)
		}
		s.Audit.Read(ctx, s.policy(ctx, id), nil, "")
		return out, nil
	})
}

// documentErrors narrows the shared error list on each operation to the statuses its
// pipeline can produce: enforce (auth, permission, rate limit, content type), body
// limits, path lookups, database faults on writes and the generic 500.
func (s *Server) documentErrors() {
	for path, item := range s.Docs.OpenAPI().Paths {
		for _, op := range []*huma.Operation{item.Get, item.Post, item.Patch, item.Delete} {
			if op == nil {
				continue
			}
			ep, ok := s.Policies[EndpointID(op.OperationID)]
			if !ok {
				continue
			}
			allowed := map[int]bool{500: true}
			write := ep.Method != http.MethodGet
			allowed[400] = write || len(op.Parameters) > 0
			allowed[401] = !ep.Public || ep.ID == "auth.login" || ep.ID == "auth.refresh"
			allowed[403] = ep.Permission != "" || ep.ID == "auth.refresh" || ep.ID == "auth.logout"
			allowed[404] = strings.Contains(path, "{")
			// Unique violations and serialization conflicts on any write.
			allowed[409] = write
			allowed[413] = op.RequestBody != nil
			allowed[429] = ep.ID != "health.get" && ep.ID != "live.get" && ep.ID != "ready.get"
			// Readiness, an unavailable auth rate store, or disabled uploads.
			allowed[503] = ep.ID == "ready.get" || ep.Rate == RateAuth || ep.ID == "upload.create"
			for code := range op.Responses {
				status, err := strconv.Atoi(code)
				if err == nil && status >= 400 && !allowed[status] {
					delete(op.Responses, code)
				}
			}
		}
	}
}
