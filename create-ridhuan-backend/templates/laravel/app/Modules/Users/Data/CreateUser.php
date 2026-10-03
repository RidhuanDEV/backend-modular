<?php

declare(strict_types=1);

namespace App\Modules\Users\Data;

final readonly class CreateUser
{
    public function __construct(public string $email, #[\SensitiveParameter] public string $password, public string $roleId) {}
}
