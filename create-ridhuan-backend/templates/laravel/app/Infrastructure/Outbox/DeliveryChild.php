<?php

declare(strict_types=1);

namespace App\Infrastructure\Outbox;

use Symfony\Component\Process\Process;

final class DeliveryChild
{
    public float $renewAt;

    public function __construct(
        public readonly Lease $lease,
        public readonly Process $process,
    ) {
        $this->renewAt = microtime(true);
    }
}
