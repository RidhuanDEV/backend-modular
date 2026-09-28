package httpapi

import (
	"context"
	"encoding/json"
	"github.com/danielgtaylor/huma/v2"
	"strings"
	"time"
)

func (s *Server) mountSystem() {
	for _, id := range []EndpointID{"health.get", "live.get"} {
		register[Empty, Status](s, id, func(context.Context, *Empty, *Actor) (Success[Status], error) { return ok(Status{Status: "ok"}), nil })
	}
	register[Empty, Status](s, "ready.get", func(ctx context.Context, input *Empty, _ *Actor) (Success[Status], error) {
		ctx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if err := s.DB.Ping(ctx); err != nil {
			return Success[Status]{}, &APIError{Status: 503, Message: "Service unavailable", Errors: []string{}}
		}
		if s.Config.RateStore == "redis" {
			if s.Redis == nil || s.Redis.Ping(ctx).Err() != nil {
				return Success[Status]{}, &APIError{Status: 503, Message: "Service unavailable", Errors: []string{}}
			}
		}
		return ok(Status{Status: "ok"}), nil
	})
	raw[Empty](s, "docs.ui", func(context.Context, *Empty) (*rawOutput, error) {
		return &rawOutput{ContentType: "text/html; charset=utf-8", Body: []byte(`<!doctype html><html><head><title>Go Backend API</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><a href="/docs/openapi.json">OpenAPI JSON</a><redoc spec-url="/docs/openapi.json"></redoc><script src="https://cdn.jsdelivr.net/npm/redoc@2.5.4/bundles/redoc.standalone.js" integrity="sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5" crossorigin="anonymous"></script></body></html>`)}, nil
	})
	raw[Empty](s, "docs.spec", func(context.Context, *Empty) (*rawOutput, error) {
		data, err := json.Marshal(s.Docs.OpenAPI())
		return &rawOutput{ContentType: "application/json", Body: data}, err
	})
	raw[ModuleInput](s, "docs.moduleSpec", func(_ context.Context, input *ModuleInput) (*rawOutput, error) {
		module := strings.TrimSuffix(input.Module, ".json")
		spec := *s.Docs.OpenAPI()
		spec.Paths = map[string]*huma.PathItem{}
		for path, item := range s.Docs.OpenAPI().Paths {
			var selected huma.PathItem
			for _, entry := range []struct {
				method    string
				operation *huma.Operation
			}{{"GET", item.Get}, {"POST", item.Post}, {"PATCH", item.Patch}, {"DELETE", item.Delete}} {
				if entry.operation == nil {
					continue
				}
				for _, tag := range entry.operation.Tags {
					if tag == module {
						switch entry.method {
						case "GET":
							selected.Get = entry.operation
						case "POST":
							selected.Post = entry.operation
						case "PATCH":
							selected.Patch = entry.operation
						case "DELETE":
							selected.Delete = entry.operation
						}
					}
				}
			}
			if selected.Get != nil || selected.Post != nil || selected.Patch != nil || selected.Delete != nil {
				spec.Paths[path] = &selected
			}
		}
		if len(spec.Paths) == 0 {
			return nil, notFound()
		}
		data, err := json.Marshal(spec)
		return &rawOutput{ContentType: "application/json", Body: data}, err
	})

}
