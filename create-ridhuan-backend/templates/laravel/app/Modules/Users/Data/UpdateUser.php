<?php

declare(strict_types=1);

namespace App\Modules\Users\Data;

final readonly class UpdateUser
{
    public function __construct(public ?string $email, public ?string $roleId) {}
}
