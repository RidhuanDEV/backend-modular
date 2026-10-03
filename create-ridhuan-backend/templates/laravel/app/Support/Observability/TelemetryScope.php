<?php

declare(strict_types=1);

namespace App\Support\Observability;

use OpenTelemetry\API\Trace\SpanInterface;
use OpenTelemetry\Context\ScopeInterface;

final readonly class TelemetryScope
{
    public function __construct(public SpanInterface $span, public ScopeInterface $context) {}
}
