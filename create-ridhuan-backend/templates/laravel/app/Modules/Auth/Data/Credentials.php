<?php

declare(strict_types=1);

namespace App\Modules\Auth\Data;

final readonly class Credentials
{
    public function __construct(
        public string $email,
        #[\SensitiveParameter] public string $password,
    ) {}
}
