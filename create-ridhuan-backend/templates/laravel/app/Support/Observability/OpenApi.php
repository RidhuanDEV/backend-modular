<?php

declare(strict_types=1);

namespace App\Support\Observability;

use App\Support\Http\ApiException;
use Dedoc\Scramble\Generator;
use Dedoc\Scramble\Scramble;

final class OpenApi
{
    /** @return array<array-key, mixed> */
    public function generate(?string $module = null): array
    {
        $result = app(Generator::class)->generate(Scramble::configure());
        $spec = $result->spec();
        if ($result->diagnostics()->isNotEmpty()) {
            throw new \RuntimeException('OpenAPI inference diagnostics require correction');
        }
        $components = $spec['components'] ?? [];
        if (! is_array($components)) {
            throw new \RuntimeException('Invalid OpenAPI components');
        }
        $components['securitySchemes'] = ['bearerAuth' => ['type' => 'http', 'scheme' => 'bearer', 'bearerFormat' => 'JWT']];
        $spec['components'] = $components;
        if ($module !== null) {
            $paths = $spec['paths'] ?? [];
            if (! is_array($paths)) {
                throw new \RuntimeException('Invalid OpenAPI paths');
            }
            foreach ($paths as $path => $operations) {
                if (! is_array($operations)) {
                    unset($paths[$path]);

                    continue;
                }
                foreach ($operations as $method => $operation) {
                    if (! is_array($operation) || ! in_array($module, is_array($operation['tags'] ?? null) ? $operation['tags'] : [], true)) {
                        unset($operations[$method]);
                    }
                }
                if ($operations === []) {
                    unset($paths[$path]);
                } else {
                    $paths[$path] = $operations;
                }
            }
            if ($paths === []) {
                throw new ApiException(404, 'Unknown docs module');
            }
            $spec['paths'] = $paths;
        }

        return $spec;
    }
}
