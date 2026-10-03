<?php

declare(strict_types=1);

namespace App\Modules\Permissions\Http;

use App\Modules\Auth\Services\Actor;
use App\Modules\Permissions\Http\Requests\CreateNameRequest;
use App\Modules\Permissions\Http\Requests\UpdateNameRequest;
use App\Modules\Permissions\Http\Resources\PermissionResource;
use App\Modules\Permissions\Models\Permission;
use App\Modules\Permissions\Services\PermissionService;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class PermissionController
{
    public function __construct(private readonly PermissionService $service, private readonly Actor $actor) {}

    public function list(): JsonResponse
    {
        return Api::data($this->service->list()->map(fn (Permission $m): array => (new PermissionResource($m))->toArray(request()))->all());
    }

    public function get(string $id): JsonResponse
    {
        return Api::resource(new PermissionResource($this->service->get($id)));
    }

    public function create(CreateNameRequest $request): JsonResponse
    {
        return Api::resource(new PermissionResource($this->service->create($request->nameValue() ?? throw new \LogicException('Required name'), $this->actor->user())), 201);
    }

    public function update(UpdateNameRequest $request, string $id): JsonResponse
    {
        return Api::resource(new PermissionResource($this->service->update($id, $request->nameValue(), $this->actor->user())));
    }

    public function delete(string $id): Response
    {
        $this->service->delete($id, $this->actor->user());

        return response()->noContent();
    }
}
