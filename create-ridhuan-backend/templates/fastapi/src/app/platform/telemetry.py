from collections.abc import AsyncGenerator, Awaitable, Callable, Generator
from contextlib import asynccontextmanager, contextmanager
from contextvars import ContextVar
from functools import wraps
from typing import Literal, ParamSpec, TypeVar

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, SpanKind, Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from sqlalchemy import event
from sqlalchemy.engine import Connection, ExceptionContext, ExecutionContext
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.settings import Settings

_operation: ContextVar[str] = ContextVar(
    "telemetry_operation", default="operations.worker"
)
_traces: TracerProvider | None = None
_metrics: MeterProvider | None = None
P = ParamSpec("P")
T = TypeVar("T")
Kind = Literal["database", "storage", "redis", "email", "cleanup"]


def setup(settings: Settings) -> None:
    global _traces, _metrics
    if not settings.otel_enabled or _traces is not None:
        return
    resource = Resource({"service.name": settings.otel_service_name})
    endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/")
    _traces = TracerProvider(resource=resource)
    _traces.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=endpoint + "/v1/traces", timeout=2)
        )
    )
    _metrics = MeterProvider(
        resource=resource,
        metric_readers=[
            PeriodicExportingMetricReader(
                OTLPMetricExporter(endpoint=endpoint + "/v1/metrics", timeout=2),
                export_interval_millis=30000,
            )
        ],
    )
    trace.set_tracer_provider(_traces)
    metrics.set_meter_provider(_metrics)


def shutdown() -> None:
    if _traces is not None:
        _traces.shutdown()
    if _metrics is not None:
        _metrics.shutdown(timeout_millis=3000)


@contextmanager
def request_span(operation_id: str, headers: dict[str, str]) -> Generator[Span]:
    token = _operation.set(operation_id)
    try:
        with trace.get_tracer("backend.operations").start_as_current_span(
            operation_id,
            context=TraceContextTextMapPropagator().extract(headers),
            kind=SpanKind.SERVER,
            attributes={"operationId": operation_id},
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            yield span
    finally:
        _operation.reset(token)


@asynccontextmanager
async def operation(kind: Kind) -> AsyncGenerator[Span]:
    operation_id = _operation.get()
    if operation_id == "operations.worker" and kind in ("email", "cleanup"):
        operation_id = (
            "notification.create" if kind == "email" else "operations.cleanup"
        )
    token = _operation.set(operation_id)
    with trace.get_tracer("backend.operations").start_as_current_span(
        kind,
        attributes={"operationId": _operation.get()},
        record_exception=False,
        set_status_on_exception=False,
    ) as span:
        try:
            yield span
        except BaseException:
            span.set_status(Status(StatusCode.ERROR))
            raise
        finally:
            _operation.reset(token)


def instrument(
    kind: Kind,
) -> Callable[[Callable[P, Awaitable[T]]], Callable[P, Awaitable[T]]]:
    def decorate(function: Callable[P, Awaitable[T]]) -> Callable[P, Awaitable[T]]:
        @wraps(function)
        async def wrapped(*args: P.args, **kwargs: P.kwargs) -> T:
            async with operation(kind):
                return await function(*args, **kwargs)

        return wrapped

    return decorate


def record_http(operation_id: str, status: int, elapsed: float) -> None:
    meter = metrics.get_meter("backend.operations")
    labels = {"operationId": operation_id, "status": status}
    meter.create_counter("backend.http.requests").add(1, labels)
    if status >= 500:
        meter.create_counter("backend.http.errors").add(1, labels)
    meter.create_histogram("backend.http.duration", unit="s").record(elapsed, labels)


def sse_connection(change: int) -> None:
    metrics.get_meter("backend.operations").create_up_down_counter(
        "backend.sse.connections"
    ).add(change, {"operationId": "notification.stream"})


def email_attempt(outcome: str) -> None:
    metrics.get_meter("backend.operations").create_counter(
        "backend.email.attempts"
    ).add(1, {"operationId": "notification.create", "outcome": outcome})


def outbox_state(count: int, age_seconds: float) -> None:
    meter = metrics.get_meter("backend.operations")
    meter.create_gauge("backend.outbox.backlog").set(count)
    meter.create_gauge("backend.outbox.oldest_age", unit="s").set(max(0, age_seconds))


def cleanup_items(kind: str, count: int, apply: bool) -> None:
    metrics.get_meter("backend.operations").create_counter("backend.cleanup.items").add(
        count, {"kind": kind, "outcome": "deleted" if apply else "candidate"}
    )


def trace_fields() -> dict[str, str]:
    value = trace.get_current_span().get_span_context()
    return (
        {
            "trace_id": format(value.trace_id, "032x"),
            "span_id": format(value.span_id, "016x"),
        }
        if value.is_valid
        else {}
    )


def instrument_database(engine: AsyncEngine) -> None:
    spans: dict[int, Span] = {}

    def before(
        connection: Connection,
        cursor: object,
        statement: str,
        parameters: object,
        execution: ExecutionContext,
        many: bool,
    ) -> None:
        spans[id(execution)] = trace.get_tracer("backend.operations").start_span(
            "database", attributes={"operationId": _operation.get()}
        )

    def after(
        connection: Connection,
        cursor: object,
        statement: str,
        parameters: object,
        execution: ExecutionContext,
        many: bool,
    ) -> None:
        span = spans.pop(id(execution), None)
        if span is not None:
            span.end()

    def failure(error: ExceptionContext) -> None:
        span = spans.pop(id(error.execution_context), None)
        if span is not None:
            span.set_status(Status(StatusCode.ERROR))
            span.end()

    event.listen(engine.sync_engine, "before_cursor_execute", before)
    event.listen(engine.sync_engine, "after_cursor_execute", after)
    event.listen(engine.sync_engine, "handle_error", failure)
