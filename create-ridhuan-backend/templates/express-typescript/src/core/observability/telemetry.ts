import {
  context,
  trace,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type { Request, Response, NextFunction } from "express";
import { loadEnvironment } from "../../config/load-env.js";

export function telemetryConfig(source: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
} {
  const flag = source["OTEL_ENABLED"] ?? "false";
  if (flag !== "true" && flag !== "false")
    throw new Error("Invalid OTEL_ENABLED");
  const endpoint =
    source["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "http://localhost:4318";
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid OTEL_EXPORTER_OTLP_ENDPOINT");
  const serviceName = source["OTEL_SERVICE_NAME"] ?? "modular-express";
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(serviceName))
    throw new Error("Invalid OTEL_SERVICE_NAME");
  return {
    enabled: flag === "true",
    endpoint: endpoint.replace(/\/$/, ""),
    serviceName,
  };
}
loadEnvironment();
const settings = telemetryConfig();
const sdk = settings.enabled
  ? new NodeSDK({
      serviceName: settings.serviceName,
      autoDetectResources: false,
      resourceDetectors: [],
      traceExporter: new OTLPTraceExporter({
        url: settings.endpoint + "/v1/traces",
        timeoutMillis: 2000,
      }),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: settings.endpoint + "/v1/metrics",
            timeoutMillis: 2000,
          }),
          exportIntervalMillis: 30000,
          exportTimeoutMillis: 3000,
        }),
      ],
    })
  : undefined;
sdk?.start();
const operations = new WeakMap<Span, () => string>();
const tracer = trace.getTracer("backend.operations");
const meter = metrics.getMeter("backend.operations");
const requests = meter.createCounter("backend.http.requests");
const errors = meter.createCounter("backend.http.errors");
const duration = meter.createHistogram("backend.http.duration", { unit: "ms" });
const sse = meter.createUpDownCounter("backend.sse.connections");
const emails = meter.createCounter("backend.email.attempts");
const cleanup = meter.createCounter("backend.cleanup.items");
const backlog = meter.createGauge("backend.outbox.backlog");
const age = meter.createGauge("backend.outbox.oldest_age", { unit: "s" });

export function httpTrace(
  id: () => string,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const parent = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(
    "http.request",
    { kind: SpanKind.SERVER },
    parent,
  );
  operations.set(span, id);
  const start = performance.now();
  let ended = false;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    const operationId = id();
    const labels = { operationId, status: res.statusCode };
    span.updateName(operationId);
    span.setAttribute("operationId", operationId);
    span.setAttribute("http.response.status_code", res.statusCode);
    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      errors.add(1, labels);
    }
    requests.add(1, labels);
    duration.record(performance.now() - start, labels);
    span.end();
  };
  res.once("finish", finish);
  res.once("close", finish);
  context.with(trace.setSpan(parent, span), next);
}
export async function observed<T>(
  kind: "database" | "storage" | "redis" | "email" | "cleanup",
  work: () => Promise<T>,
): Promise<T> {
  const parent = trace.getActiveSpan();
  const operation = parent ? operations.get(parent) : undefined;
  return tracer.startActiveSpan(kind, async (span) => {
    if (operation) {
      operations.set(span, operation);
      span.setAttribute("operationId", operation());
    } else {
      const operationId =
        kind === "email" ? "notification.create" : "operations.cleanup";
      operations.set(span, () => operationId);
      span.setAttribute("operationId", operationId);
    }
    try {
      return await work();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
export function databaseDuration(milliseconds: number): void {
  const end = Date.now();
  const span = tracer.startSpan("database", { startTime: end - milliseconds });
  const parent = trace.getActiveSpan();
  const operation = parent ? operations.get(parent) : undefined;
  span.setAttribute("operationId", operation?.() ?? "operations.worker");
  span.end(end);
}
export function traceFields(): { traceId?: string; spanId?: string } {
  const value = trace.getActiveSpan()?.spanContext();
  return value && value.traceId !== "00000000000000000000000000000000"
    ? { traceId: value.traceId, spanId: value.spanId }
    : {};
}
export function sseConnection(change: 1 | -1): void {
  sse.add(change, { operationId: "notification.stream" });
}
export function emailAttempt(outcome: "SENT" | "FAILED" | "RETRY"): void {
  emails.add(1, { operationId: "notification.create", outcome });
}
export function cleanupItems(
  kind: "sessions" | "outbox" | "audit" | "uploads",
  count: number,
  apply: boolean,
): void {
  cleanup.add(count, { kind, outcome: apply ? "deleted" : "candidate" });
}
export function outboxState(count: number, oldest?: Date): void {
  backlog.record(count);
  age.record(oldest ? Math.max(0, (Date.now() - oldest.getTime()) / 1000) : 0);
}
export async function shutdownTelemetry(): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    /* Collector availability never affects application shutdown. */
  }
}
