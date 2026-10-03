<?php

declare(strict_types=1);

namespace App\Support\Observability;

use App\Support\Endpoint\EndpointRegistry;
use App\Support\Http\ErrorEnvelope;
use Dedoc\Scramble\Contracts\OperationTransformer;
use Dedoc\Scramble\Infer;
use Dedoc\Scramble\Infer\Scope\GlobalScope;
use Dedoc\Scramble\Infer\Services\ReferenceTypeResolver;
use Dedoc\Scramble\Support\Generator\Operation;
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
        app(Infer::class)->analyzeClass(ErrorEnvelope::class);
        foreach ([400, 401, 403, 404, 409, 422, 429, 500, 503] as $status) {
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
    }
}
