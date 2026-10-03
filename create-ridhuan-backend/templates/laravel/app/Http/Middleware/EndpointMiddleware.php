<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Infrastructure\RateLimit\Quota;
use App\Modules\Auth\Services\JwtService;
use App\Modules\Users\Models\User;
use App\Support\Audit\Audit;
use App\Support\Config\Settings;
use App\Support\Endpoint\EndpointRegistry;
use App\Support\Http\ApiException;
use App\Support\Observability\Telemetry;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

final class EndpointMiddleware
{
    public function __construct(private readonly EndpointRegistry $registry, private readonly Quota $quota, private readonly JwtService $jwt, private readonly Audit $audit, private readonly Telemetry $telemetry) {}

    /** @param Closure(Request): Response $next */
    public function handle(Request $request, Closure $next): Response
    {
        $name = $request->route()?->getName();
        if ($name === null) {
            throw new ApiException(404, 'Endpoint not found');
        }
        $definition = $this->registry->get($name);
        $supplied = $request->header('X-Request-ID');
        $requestId = is_string($supplied) && preg_match('/^[A-Za-z0-9_-]{1,64}$/D', $supplied) ? $supplied : Str::uuid()->toString();
        $request->attributes->set('requestId', $requestId);
        $scope = $this->telemetry->start($name);
        $request->attributes->set('traceId', $scope?->span->getContext()->getTraceId());
        Log::shareContext(['requestId' => $requestId, 'operation' => $name, ...($scope === null ? [] : ['traceId' => $scope->span->getContext()->getTraceId()])]);
        $started = microtime(true);
        $status = 500;
        try {
            if (! in_array($name, ['health.get', 'live.get', 'ready.get'], true)) {
                Settings::validate();
                $this->quota->take($definition->rate === 'auth' ? 'auth' : 'public', $request->ip() ?? 'unknown');
            }
            auth()->forgetGuards();
            $user = null;
            if ($definition->authenticated) {
                $bearer = $request->bearerToken();
                if ($bearer === null) {
                    throw new ApiException(401, 'Authentication required');
                }
                $claims = $this->jwt->verify($bearer);
                $request->attributes->set('accessExpiry', $claims->expiresAt);
                $candidate = auth('api')->user();
                if (! $candidate instanceof User) {
                    throw new ApiException(401, 'Inactive user');
                }
                $user = $candidate;
                if ($definition->permission !== null) {
                    Gate::forUser($user)->authorize('backend.permission', $definition->permission);
                }
                $this->quota->take($definition->rate, $user->id);
            }
            if ($definition->audit === 'optional' && $definition->capability === 'read') {
                $this->audit->write('READ', $definition->module, null, $user?->id);
            }
            $cacheable = $definition->cache === 'read' && Settings::boolean('backend.cache');
            $generation = 0;
            if ($cacheable) {
                try {
                    $value = Cache::store('redis')->get('response-generation', 0);
                    $number = (is_int($value) || is_string($value)) ? filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]) : false;
                    if (! is_int($number)) {
                        throw new \RuntimeException('Invalid cache generation');
                    }
                    $generation = $number;
                } catch (Throwable) {
                    $cacheable = false;
                }
            }
            $key = 'response:'.$generation.':'.hash('sha256', $name.':'.($user === null ? 'public' : $user->id).':'.$request->getQueryString());
            if ($cacheable) {
                try {
                    $cached = Cache::store('redis')->get($key);
                    if (is_array($cached)) {
                        $response = response()->json($cached);
                        $response->headers->set('X-Request-ID', $requestId);
                        $status = 200;

                        return $response;
                    }
                } catch (Throwable $error) {
                    Log::warning('cache_read_failed', ['type' => $error::class]);
                }
            }
            $response = $next($request);
            $status = $response->getStatusCode();
            if ($cacheable && $response instanceof JsonResponse && $status === 200) {
                try {
                    Cache::store('redis')->put($key, $response->getData(true), 60);
                } catch (Throwable $error) {
                    Log::warning('cache_write_failed', ['type' => $error::class]);
                }
            }
            // Mutation invalidation increments a deployment generation instead of deleting unrelated keys.
            if ($definition->method !== 'GET' && $status < 300 && Settings::boolean('backend.cache')) {
                try {
                    Cache::store('redis')->add('response-generation', 0);
                    Cache::store('redis')->increment('response-generation');
                } catch (Throwable $error) {
                    Log::warning('cache_invalidation_failed', ['type' => $error::class]);
                }
            }
            $response->headers->set('X-Request-ID', $requestId);
            $response->headers->set('X-Content-Type-Options', 'nosniff');

            return $response;
        } catch (Throwable $error) {
            $status = match (true) {
                $error instanceof ApiException => $error->status,
                $error instanceof ValidationException => 422,
                $error instanceof AuthorizationException => 403,
                $error instanceof ModelNotFoundException => 404,
                $error instanceof HttpExceptionInterface => $error->getStatusCode(),
                default => 500,
            };
            throw $error;
        } finally {
            $this->telemetry->finish($scope, $name, $status, microtime(true) - $started);
            Log::flushSharedContext();
            auth()->forgetGuards();
        }
    }
}
