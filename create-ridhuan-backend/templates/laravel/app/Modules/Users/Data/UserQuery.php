<?php

declare(strict_types=1);

namespace App\Modules\Users\Data;

final readonly class UserQuery
{
    public function __construct(public int $page, public int $limit, public ?string $search, public string $sortBy, public string $orderBy, public ?string $fields) {}
}
