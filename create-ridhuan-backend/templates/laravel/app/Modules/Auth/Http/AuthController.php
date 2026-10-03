<?php

declare(strict_types=1);

namespace App\Modules\Auth\Http;

use App\Modules\Auth\Http\Requests\LoginRequest;
use App\Modules\Auth\Http\Requests\RefreshRequest;
use App\Modules\Auth\Http\Requests\RegisterRequest;
use App\Modules\Auth\Http\Resources\AuthUserResource;
use App\Modules\Auth\Services\Actor;
use App\Modules\Auth\Services\AuthService;
use App\Support\Http\Api;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\Response;

final class AuthController
{
    public function __construct(private readonly AuthService $service, private readonly Actor $actor) {}

    public function register(RegisterRequest $request): JsonResponse
    {
        return Api::resource(new AuthUserResource($this->service->register($request->dto())), 201);
    }

    public function login(LoginRequest $request): JsonResponse
    {
        $v = $this->service->login($request->dto());

        return Api::data(['token' => $v->token, 'refreshToken' => $v->refreshToken]);
    }

    public function refresh(RefreshRequest $request): JsonResponse
    {
        $v = $this->service->refresh($request->token());

        return Api::data(['token' => $v->token, 'refreshToken' => $v->refreshToken]);
    }

    public function logout(RefreshRequest $request): Response
    {
        $this->service->logout($request->token());

        return response()->noContent();
    }

    public function me(): JsonResponse
    {
        return Api::resource(new AuthUserResource($this->actor->user()));
    }
}
