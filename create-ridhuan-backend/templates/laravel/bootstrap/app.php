<?php

declare(strict_types=1);

use App\Http\Middleware\ConfiguredProxies;
use App\Http\Middleware\EndpointMiddleware;
use App\Support\Http\ApiException;
use App\Support\Http\ErrorEnvelope;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

$application = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        commands: __DIR__ . '/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->group('web', [EndpointMiddleware::class]);
        $middleware->remove(ConvertEmptyStringsToNull::class);
        $middleware->replace(TrustProxies::class, ConfiguredProxies::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->report(function (Throwable $error): bool {
            $request = app()->bound('request') ? app('request') : null;
            $requestId =
                $request instanceof Request
                    ? $request->attributes->get('requestId')
                    : null;
            $traceId =
                $request instanceof Request
                    ? $request->attributes->get('traceId')
                    : null;
            Log::error('request_failed', [
                'type' => $error::class,
                ...is_string($requestId) ? ['requestId' => $requestId] : [],
                ...is_string($traceId) ? ['traceId' => $traceId] : [],
            ]);

            return false;
        });
        $exceptions->shouldRenderJsonWhen(
            fn(Request $request, Throwable $error): bool => true,
        );
        $exceptions->render(function (
            Throwable $error,
            Request $request,
        ): JsonResponse {
            $status = match (true) {
                $error instanceof ApiException => $error->status,
                $error instanceof ValidationException => 422,
                $error instanceof AuthorizationException => 403,
                $error instanceof ModelNotFoundException => 404,
                $error instanceof UniqueConstraintViolationException => 409,
                $error instanceof HttpExceptionInterface
                    => $error->getStatusCode(),
                default => 500,
            };
            $payload =
                $error instanceof ValidationException
                    ? ErrorEnvelope::validationResponse(
                        $error->getMessage(),
                        ErrorEnvelope::validation($error),
                    )
                    : ErrorEnvelope::make(
                        match (true) {
                            $status >= 500 => 'Service unavailable',
                            $error instanceof UniqueConstraintViolationException
                                => 'Resource already exists',
                            $error instanceof ModelNotFoundException
                                => 'Resource not found',
                            default => $error->getMessage(),
                        },
                    );
            $response = response()->json($payload, $status);
            $id = $request->attributes->get('requestId');
            if (is_string($id)) {
                $response->headers->set('X-Request-ID', $id);
            }
            if ($status === 429) {
                $response->headers->set('Retry-After', '60');
            }

            return $response;
        });
    })
    ->create();

if (PHP_OS_FAMILY === 'Windows') {
    foreach (range('A', 'Z') as $drive) {
        $application->addAbsoluteCachePathPrefix($drive . ':/');
        $application->addAbsoluteCachePathPrefix($drive . ':\\');
        $application->addAbsoluteCachePathPrefix(strtolower($drive) . ':/');
        $application->addAbsoluteCachePathPrefix(strtolower($drive) . ':\\');
    }
}

return $application;
