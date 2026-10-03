<?php

declare(strict_types=1);

namespace App\Modules\System\Http;

use App\Support\Observability\OpenApi;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class DocsController
{
    public function __construct(private readonly OpenApi $api) {}

    public function spec(): JsonResponse
    {
        return response()->json($this->api->generate());
    }

    public function moduleSpec(string $module): JsonResponse
    {
        return response()->json($this->api->generate($module));
    }

    public function ui(): Response
    {
        return response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Backend API</title></head><body><h1>Backend API</h1><p>JWT bearer authentication. Native Laravel validation: 422.</p><a href="/docs/openapi.json">OpenAPI 3.1 document</a><script id="api-reference" data-url="/docs/openapi.json"></script><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.36.1"></script></body></html>',
            200,
            ['Content-Type' => 'text/html'],
        );
    }
}
