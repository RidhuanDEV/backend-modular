package telemetry

import (
	"context"
	"errors"

	"github.com/RidhuanDEV/golang-backend/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
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
	traces, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	metrics, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, err
	}
	traceProvider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traces), sdktrace.WithResource(res))
	meterProvider := metric.NewMeterProvider(metric.WithReader(metric.NewPeriodicReader(metrics)), metric.WithResource(res))
	otel.SetTracerProvider(traceProvider)
	otel.SetMeterProvider(meterProvider)
	return func(ctx context.Context) error {
		return errors.Join(traceProvider.Shutdown(ctx), meterProvider.Shutdown(ctx))
	}, nil
}
