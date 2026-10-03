<?php

declare(strict_types=1);

namespace App\Modules\Auth\Data;

final readonly class AccessClaims
{
    public function __construct(public string $userId, public int $expiresAt) {}
}
