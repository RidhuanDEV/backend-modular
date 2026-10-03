<?php

declare(strict_types=1);

namespace App\Support\Observability;

use App\Support\Config\Settings;
use Illuminate\Support\Facades\Log;
use OpenTelemetry\API\Common\Time\Clock;
use OpenTelemetry\API\Metrics\CounterInterface;
use OpenTelemetry\API\Metrics\HistogramInterface;
use OpenTelemetry\Contrib\Otlp\MetricExporter;
use OpenTelemetry\Contrib\Otlp\OtlpHttpTransportFactory;
use OpenTelemetry\Contrib\Otlp\SpanExporter;
use OpenTelemetry\SDK\Common\Attribute\Attributes;
use OpenTelemetry\SDK\Metrics\MeterProvider;
use OpenTelemetry\SDK\Metrics\MeterProviderInterface;
use OpenTelemetry\SDK\Metrics\MetricReader\ExportingReader;
use OpenTelemetry\SDK\Resource\ResourceInfo;
use OpenTelemetry\SDK\Trace\SpanProcessor\BatchSpanProcessor;
use OpenTelemetry\SDK\Trace\TracerProvider;
use Throwable;

final class Telemetry
{
    private ?TracerProvider $traces = null;

    private ?MeterProviderInterface $metrics = null;

    private ?CounterInterface $requests = null;

    private ?HistogramInterface $duration = null;

    private ?CounterInterface $events = null;

    public function start(string $operation): ?TelemetryScope
    {
        if ($operation === '') {
            throw new \InvalidArgumentException('Telemetry operation is required');
        }
        if (! Settings::boolean('backend.otel.enabled')) {
            return null;
        }
        try {
            if ($this->traces === null) {
                $endpoint = rtrim(Settings::string('backend.otel.endpoint'), '/');
                $factory = new OtlpHttpTransportFactory;
                $resource = ResourceInfo::create(Attributes::create(['service.name' => Settings::string('backend.otel.service')]));
                $processor = new BatchSpanProcessor(new SpanExporter($factory->create($endpoint.'/v1/traces', 'application/x-protobuf', timeout: 0.3, maxRetries: 0)), Clock::getDefault(), maxQueueSize: 128, exportTimeoutMillis: 500, maxExportBatchSize: 128, autoFlush: false);
                $this->traces = new TracerProvider($processor, resource: $resource);
                $this->metrics = MeterProvider::builder()->setResource($resource)->addReader(new ExportingReader(new MetricExporter($factory->create($endpoint.'/v1/metrics', 'application/x-protobuf', timeout: 0.3, maxRetries: 0))))->build();
                $meter = $this->metrics->getMeter('backend');
                $this->requests = $meter->createCounter('backend.operations');
                $this->duration = $meter->createHistogram('backend.duration', 's');
                $this->events = $meter->createCounter('backend.events');
            }
            $span = $this->traces->getTracer('backend')->spanBuilder($operation)->startSpan();

            return new TelemetryScope($span, $span->activate());
        } catch (Throwable $error) {
            Log::warning('telemetry_unavailable', ['type' => $error::class]);

            return null;
        }
    }

    public function finish(?TelemetryScope $scope, string $operation, int $status, float $seconds, bool $flush = true): void
    {
        if ($scope === null) {
            return;
        }
        try {
            $attributes = ['operation' => $operation, 'status' => $status];
            $this->requests?->add(1, $attributes);
            $this->duration?->record($seconds, $attributes);
            $scope->span->setAttribute('http.response.status_code', $status);
            $scope->span->end();
            if ($flush) {
                $this->traces?->forceFlush();
                $this->metrics?->forceFlush();
            }
        } catch (Throwable $error) {
            Log::warning('telemetry_export_failed', ['type' => $error::class]);
        } finally {
            $scope->context->detach();
        }
    }

    public function measure(string $operation, float $seconds, int $status = 200): void
    {
        $scope = $this->start($operation);
        $this->finish($scope, $operation, $status, $seconds, false);
    }

    public function event(string $operation, int $count = 1): void
    {
        try {
            $this->events?->add($count, ['operation' => $operation]);
        } catch (Throwable $error) {
            Log::warning('telemetry_event_failed', ['type' => $error::class]);
        }
    }
}
