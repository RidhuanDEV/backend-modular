<?php

declare(strict_types=1);

namespace App\Support\Time;

use Carbon\CarbonImmutable;

final class Clock
{
    public function now(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC');
    }
}
