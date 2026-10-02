package telemetry

import (
	"context"
	"errors"
	"net/url"
	"path"
	"time"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.37.0"
)

func Setup(ctx context.Context, c config.Config) (func(context.Context) error, error) {
	if !c.OTelEnabled {
		return func(context.Context) error { return nil }, nil
	}
	res, err := resource.New(ctx, resource.WithSchemaURL(semconv.SchemaURL), resource.WithAttributes(semconv.ServiceNameKey.String(c.OTelServiceName)))
	if err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(c.OTelEndpoint)
	if err != nil {
		return nil, err
	}
	traces, err := otlptracehttp.New(ctx, otlptracehttp.WithTimeout(2*time.Second), otlptracehttp.WithEndpointURL(c.OTelEndpoint), otlptracehttp.WithURLPath(path.Join(endpoint.Path, "/v1/traces")))
	if err != nil {
		return nil, err
	}
	metrics, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithTimeout(2*time.Second), otlpmetrichttp.WithEndpointURL(c.OTelEndpoint), otlpmetrichttp.WithURLPath(path.Join(endpoint.Path, "/v1/metrics")))
	if err != nil {
		return nil, err
	}
	traceProvider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traces), sdktrace.WithResource(res))
	meterProvider := metric.NewMeterProvider(metric.WithReader(metric.NewPeriodicReader(metrics)), metric.WithResource(res))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	otel.SetTracerProvider(traceProvider)
	otel.SetMeterProvider(meterProvider)
	return func(ctx context.Context) error {
		return errors.Join(traceProvider.Shutdown(ctx), meterProvider.Shutdown(ctx))
	}, nil
}
