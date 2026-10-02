package telemetry

import (
	"context"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
	"time"
)

type OperationKey struct{}

func Server(ctx context.Context) (context.Context, trace.Span) {
	return otel.Tracer("backend.operations").Start(ctx, "http.server", trace.WithSpanKind(trace.SpanKindServer))
}
func Label(span trace.Span, operation string, status int) {
	span.SetName(operation)
	span.SetAttributes(attribute.String("operationId", operation), attribute.Int("status", status))
	if status >= 500 {
		span.SetStatus(codes.Error, "")
	}
}
func Start(ctx context.Context, kind string) (context.Context, trace.Span) {
	operation, _ := ctx.Value(OperationKey{}).(string)
	if operation == "" {
		switch kind {
		case "email":
			operation = "notification.create"
		case "cleanup":
			operation = "operations.cleanup"
		default:
			operation = "operations.worker"
		}
	}
	return otel.Tracer("backend.operations").Start(context.WithValue(ctx, OperationKey{}, operation), kind, trace.WithAttributes(attribute.String("operationId", operation)))
}
func Finish(span trace.Span, err error) {
	if err != nil {
		span.SetStatus(codes.Error, "")
	}
	span.End()
}
func HTTP(ctx context.Context, operation string, status int, elapsed time.Duration) {
	m := otel.Meter("backend.operations")
	labels := metric.WithAttributes(attribute.String("operationId", operation), attribute.Int("status", status))
	counter, _ := m.Int64Counter("backend.http.requests")
	counter.Add(ctx, 1, labels)
	duration, _ := m.Float64Histogram("backend.http.duration", metric.WithUnit("s"))
	duration.Record(ctx, elapsed.Seconds(), labels)
	if status >= 500 {
		failures, _ := m.Int64Counter("backend.http.errors")
		failures.Add(ctx, 1, labels)
	}
}
func SSE(ctx context.Context, change int64) {
	m, _ := otel.Meter("backend.operations").Int64UpDownCounter("backend.sse.connections")
	m.Add(ctx, change)
}
func Email(ctx context.Context, outcome string) {
	m, _ := otel.Meter("backend.operations").Int64Counter("backend.email.attempts")
	m.Add(ctx, 1, metric.WithAttributes(attribute.String("outcome", outcome)))
}
func Cleanup(ctx context.Context, kind string, count int64, apply bool) {
	m, _ := otel.Meter("backend.operations").Int64Counter("backend.cleanup.items")
	m.Add(ctx, count, metric.WithAttributes(attribute.String("kind", kind), attribute.Bool("apply", apply)))
}
func Outbox(ctx context.Context, count int64, age float64) {
	m := otel.Meter("backend.operations")
	backlog, _ := m.Int64Gauge("backend.outbox.backlog")
	backlog.Record(ctx, count)
	oldest, _ := m.Float64Gauge("backend.outbox.oldest_age", metric.WithUnit("s"))
	oldest.Record(ctx, max(0, age))
}
