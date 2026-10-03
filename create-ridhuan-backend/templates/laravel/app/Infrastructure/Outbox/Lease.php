<?php

declare(strict_types=1);

namespace App\Infrastructure\Outbox;

final readonly class Lease
{
    public function __construct(public string $jobId, public string $leaseId) {}
}
