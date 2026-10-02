package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"go.opentelemetry.io/otel"
)

func TestGenericEndpointExportsBothSignals(t *testing.T) {
	for _, prefix := range []string{"", "/collector"} {
		t.Run(prefix, func(t *testing.T) {
			var mutex sync.Mutex
			paths := make(map[string]int)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mutex.Lock()
				paths[r.URL.Path]++
				mutex.Unlock()
				w.Header().Set("Content-Type", "application/x-protobuf")
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()
			previousTracer, previousMeter, previousPropagator := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
			defer func() {
				otel.SetTracerProvider(previousTracer)
				otel.SetMeterProvider(previousMeter)
				otel.SetTextMapPropagator(previousPropagator)
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			shutdown, err := Setup(ctx, config.Config{OTelEnabled: true, OTelEndpoint: server.URL + prefix, OTelServiceName: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			_, span := Server(ctx)
			Label(span, "live.get", 200)
			span.End()
			HTTP(ctx, "live.get", 200, time.Millisecond)
			if err := shutdown(ctx); err != nil {
				t.Fatal(err)
			}
			mutex.Lock()
			defer mutex.Unlock()
			for _, signal := range []string{"/v1/traces", "/v1/metrics"} {
				if paths[prefix+signal] == 0 {
					t.Errorf("missing export to %s: %v", prefix+signal, paths)
				}
			}
		})
	}
}
