<?php

declare(strict_types=1);

namespace App\Support\Endpoint;

final readonly class EndpointDefinition
{
    /** @param class-string $controller */
    public function __construct(public EndpointId $id, public string $method, public string $path, public string $module, public string $controller, public string $action, public int $status, public bool $authenticated, public ?string $permission, public string $audit, public string $capability, public string $rate, public string $cache, public string $media = 'application/json') {}
}
