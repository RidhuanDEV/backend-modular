<?php

declare(strict_types=1);

namespace App\Support\Http;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

final class Api
{
    public static function resource(JsonResource $resource, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $resource->resolve()], $status);
    }

    /** @param array<array-key, scalar|null|array<array-key, mixed>> $data */
    public static function data(array $data, int $status = 200): JsonResponse
    {
        return response()->json(['success' => true, 'data' => $data], $status);
    }
}
