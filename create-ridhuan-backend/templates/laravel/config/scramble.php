<?php

declare(strict_types=1);
use App\Support\Observability\DeclaredModelProperties;
use App\Support\Observability\ResourceEnvelopeInference;

return ['api_path' => '', 'api_domain' => null, 'info' => ['version' => '1.0.0', 'description' => 'Native Laravel validation returns 422. UUID cursors remain recipient scoped.'], 'servers' => null, 'middleware' => [], 'extensions' => [DeclaredModelProperties::class, ResourceEnvelopeInference::class]];
