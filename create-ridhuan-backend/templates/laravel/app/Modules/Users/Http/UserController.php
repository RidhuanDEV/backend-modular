<?php

declare(strict_types=1);

namespace App\Modules\Users\Http;

use App\Modules\Auth\Services\Actor;
use App\Modules\Users\Http\Requests\CreateUserRequest;
use App\Modules\Users\Http\Requests\ListUsersRequest;
use App\Modules\Users\Http\Requests\UpdateUserRequest;
use App\Modules\Users\Http\Resources\UserResource;
use App\Modules\Users\Models\User;
use App\Modules\Users\Services\UserService;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class UserController
{
    public function __construct(private readonly UserService $service, private readonly Actor $actor) {}

    public function list(ListUsersRequest $request): JsonResponse
    {
        $q = $request->dto();
        $p = $this->service->list($q);
        $fields = $q->fields === null ? null : array_map('trim', explode(',', $q->fields));
        $data = $p->getCollection()->map(fn (User $model): array => (new UserResource($model))->project($fields))->all();

        return response()->json(['success' => true, 'data' => $data, 'meta' => ['page' => $p->currentPage(), 'limit' => $p->perPage(), 'totalItems' => $p->total(), 'totalPages' => $p->lastPage(), 'hasNextPage' => $p->hasMorePages(), 'hasPrevPage' => $p->currentPage() > 1]]);
    }

    public function get(string $id): JsonResponse
    {
        return Api::resource(new UserResource($this->service->get($id)));
    }

    public function create(CreateUserRequest $request): JsonResponse
    {
        return Api::resource(new UserResource($this->service->create($request->dto(), $this->actor->user())), 201);
    }

    public function update(UpdateUserRequest $request, string $id): JsonResponse
    {
        return Api::resource(new UserResource($this->service->update($id, $request->dto(), $this->actor->user())));
    }

    public function delete(string $id): Response
    {
        $this->service->delete($id, $this->actor->user());

        return response()->noContent();
    }
}
