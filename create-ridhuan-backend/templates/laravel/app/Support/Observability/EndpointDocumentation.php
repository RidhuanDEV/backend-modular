<?php

declare(strict_types=1);

namespace App\Support\Observability;

use App\Support\Endpoint\EndpointDefinition;
use App\Support\Endpoint\EndpointRegistry;
use App\Support\Http\ErrorEnvelope;
use Dedoc\Scramble\Contracts\OperationTransformer;
use Dedoc\Scramble\Infer;
use Dedoc\Scramble\Infer\Scope\GlobalScope;
use Dedoc\Scramble\Infer\Services\ReferenceTypeResolver;
use Dedoc\Scramble\Support\Generator\Header;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\Response;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\SecurityRequirement;
use Dedoc\Scramble\Support\Generator\Types\StringType;
use Dedoc\Scramble\Support\Generator\TypeTransformer;
use Dedoc\Scramble\Support\RouteInfo;
use Dedoc\Scramble\Support\Type\ArrayType as InferArrayType;
use Dedoc\Scramble\Support\Type\Reference\StaticMethodCallReferenceType;
use Dedoc\Scramble\Support\Type\StringType as InferStringType;

final class EndpointDocumentation implements OperationTransformer
{
    private const REFRESH_COOKIE_MODES =
        'Refresh token transport is set by REFRESH_TOKEN_TRANSPORT. ' .
        'body (default): the refresh token travels in JSON. ' .
        'cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth and omit it from the response body; ' .
        'refresh and logout read the cookie when the body has no refreshToken, and then require the X-Requested-With header (send credentials: "include" cross-origin). ' .
        'A refreshToken in the body always takes precedence.';

    public function __construct(
        private readonly TypeTransformer $transformer,
    ) {}

    public function handle(Operation $operation, RouteInfo $routeInfo): void
    {
        $name = $routeInfo->route->getName();
        if ($name === null) {
            throw new \LogicException('Unnamed endpoint');
        }
        $definition = app(EndpointRegistry::class)->get($name);
        $operation->setOperationId($name);
        $operation->setTags([$definition->module]);
        $operation->security = $definition->authenticated
            ? [new SecurityRequirement(['bearerAuth' => []])]
            : [];
        $operation->setExtensionProperty('audit', $definition->audit);
        $operation->setExtensionProperty('permission', $definition->permission);
        $operation->setExtensionProperty('rate-group', $definition->rate);
        if (
            $definition->media === 'text/event-stream' ||
            $definition->media === 'text/html'
        ) {
            $response = new Response($definition->status);
            $response->setDescription($definition->media);
            $schema = new Schema();
            $schema->type = new StringType();
            $response->setContent($definition->media, $schema);
            $operation->responses = [$response];
        } elseif ($definition->status === 204) {
            $response = new Response(204);
            $response->setDescription('No content');
            $operation->responses = [$response];
        }
        // Inferred error responses are replaced by the envelope for each status below.
        $operation->responses = array_values(
            array_filter(
                $operation->responses ?? [],
                static fn($response): bool => !(
                    $response instanceof Response &&
                    is_int($response->code) &&
                    $response->code >= 400
                ),
            ),
        );
        app(Infer::class)->analyzeClass(ErrorEnvelope::class);
        foreach ($this->errorStatuses($definition, $operation) as $status) {
            $arguments = [new InferStringType()];
            if ($status === 422) {
                $arguments[] = new InferArrayType(
                    new InferArrayType(new InferStringType()),
                    new InferStringType(),
                );
            }
            $type = ReferenceTypeResolver::getInstance()->resolve(
                new GlobalScope(),
                new StaticMethodCallReferenceType(
                    ErrorEnvelope::class,
                    $status === 422 ? 'validationResponse' : 'make',
                    $arguments,
                ),
            );
            $errorSchema = new Schema();
            $errorSchema->type = $this->transformer->transform($type);
            $response = new Response($status);
            $response->setDescription('API error');
            $response->setContent('application/json', $errorSchema);
            $operation->addResponse($response);
        }
        if (
            in_array($name, ['auth.login', 'auth.refresh', 'auth.logout'], true)
        ) {
            $this->documentRefreshCookie(
                $operation,
                $name,
                $definition->status,
            );
        }
    }

    /**
     * Statuses the pipeline can produce: native validation (422), explicit 400s,
     * authentication and permissions, lookups, unique conflicts on writes, body limits,
     * rate limiting (probes are exempt), dependency outages and the 500 handler.
     *
     * @return list<int>
     */
    private function errorStatuses(
        EndpointDefinition $definition,
        Operation $operation,
    ): array {
        $name = $definition->id->value;
        $write = $definition->method !== 'GET';
        $input =
            $operation->requestBodyObject !== null ||
            $operation->parameters !== [];
        $probe = in_array($name, ['health.get', 'live.get', 'ready.get'], true);
        $statuses = [500];
        if (
            in_array(
                $name,
                [
                    'auth.refresh',
                    'auth.logout',
                    'notification.list',
                    'notification.stream',
                ],
                true,
            )
        ) {
            $statuses[] = 400;
        }
        if (
            $definition->authenticated ||
            in_array($name, ['auth.login', 'auth.refresh'], true)
        ) {
            $statuses[] = 401;
        }
        if (
            $definition->permission !== null ||
            in_array($name, ['auth.refresh', 'auth.logout'], true)
        ) {
            $statuses[] = 403;
        }
        if (
            str_contains($definition->path, '{') ||
            str_starts_with($name, 'docs.') ||
            $name === 'notification.create'
        ) {
            $statuses[] = 404;
        }
        if ($write) {
            $statuses[] = 409;
        }
        if ($operation->requestBodyObject !== null) {
            $statuses[] = 413;
        }
        if ($input || $write) {
            $statuses[] = 422;
        }
        if (!$probe) {
            $statuses[] = 429;
        }
        if (
            $name === 'ready.get' ||
            $definition->rate === 'auth' ||
            in_array($name, ['notification.stream', 'upload.create'], true)
        ) {
            $statuses[] = 503;
        }
        sort($statuses);

        return $statuses;
    }

    /** Documents both refresh token transports on the endpoints that issue or consume it. */
    private function documentRefreshCookie(
        Operation $operation,
        string $name,
        int $status,
    ): void {
        $operation->description(self::REFRESH_COOKIE_MODES);
        $text = new Schema();
        $text->type = new StringType();
        foreach ($operation->responses ?? [] as $response) {
            if ($response instanceof Response && $response->code === $status) {
                $response->addHeader(
                    'Set-Cookie',
                    new Header(
                        description: $name === 'auth.logout'
                            ? 'Cookie mode only: clears the refresh cookie'
                            : 'Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)',
                        schema: $text,
                    ),
                );
            }
        }
        if ($name === 'auth.login') {
            return;
        }
        $header = Parameter::make('X-Requested-With', 'header');
        $header->required = false;
        $header->description =
            'Required (any value) when the refresh token comes from the cookie';
        $header->setSchema($text);
        $operation->addParameters([$header]);
    }
}
