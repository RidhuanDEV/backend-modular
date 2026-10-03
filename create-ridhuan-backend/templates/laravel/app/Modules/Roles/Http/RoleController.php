<?php

declare(strict_types=1);

namespace App\Modules\Roles\Http;

use App\Modules\Auth\Services\Actor;
use App\Modules\Roles\Http\Requests\AssignPermissionsRequest;
use App\Modules\Roles\Http\Requests\CreateNameRequest;
use App\Modules\Roles\Http\Requests\UpdateNameRequest;
use App\Modules\Roles\Http\Resources\RoleResource;
use App\Modules\Roles\Models\Role;
use App\Modules\Roles\Services\RoleService;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class RoleController
{
    public function __construct(private readonly RoleService $service, private readonly Actor $actor) {}

    public function list(): JsonResponse
    {
        return Api::data($this->service->list()->map(fn (Role $m): array => (new RoleResource($m))->toArray(request()))->all());
    }

    public function get(string $id): JsonResponse
    {
        return Api::resource(new RoleResource($this->service->get($id)));
    }

    public function create(CreateNameRequest $request): JsonResponse
    {
        return Api::resource(new RoleResource($this->service->create($request->nameValue() ?? throw new \LogicException('Required name'), $this->actor->user())), 201);
    }

    public function update(UpdateNameRequest $request, string $id): JsonResponse
    {
        return Api::resource(new RoleResource($this->service->update($id, $request->nameValue(), $this->actor->user())));
    }

    public function delete(string $id): Response
    {
        $this->service->delete($id, $this->actor->user());

        return response()->noContent();
    }

    public function assignPermissions(AssignPermissionsRequest $request, string $id): JsonResponse
    {
        return Api::resource(new RoleResource($this->service->assign($id, $request->ids(), $this->actor->user())));
    }
}
