<?php

declare(strict_types=1);

namespace App\Modules\Auth\Data;

final readonly class Tokens
{
    public function __construct(public string $token, public string $refreshToken) {}
}
