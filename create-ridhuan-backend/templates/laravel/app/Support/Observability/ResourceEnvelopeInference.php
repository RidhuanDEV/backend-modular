<?php

declare(strict_types=1);

namespace App\Support\Observability;

use App\Support\Http\Api;
use Dedoc\Scramble\Infer\Extensions\Event\StaticMethodCallEvent;
use Dedoc\Scramble\Infer\Extensions\StaticMethodReturnTypeExtension;
use Dedoc\Scramble\Support\Type\ArrayItemType_;
use Dedoc\Scramble\Support\Type\ArrayType;
use Dedoc\Scramble\Support\Type\Generic;
use Dedoc\Scramble\Support\Type\KeyedArrayType;
use Dedoc\Scramble\Support\Type\Literal\LiteralBooleanType;
use Dedoc\Scramble\Support\Type\Literal\LiteralIntegerType;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;

/** Reflects Api::resource's envelope while preserving the actual resource argument. */
final class ResourceEnvelopeInference implements StaticMethodReturnTypeExtension
{
    public function shouldHandle(string $name): bool
    {
        return $name === Api::class;
    }

    public function getStaticMethodReturnType(StaticMethodCallEvent $event): ?Type
    {
        if ($event->name !== 'resource') {
            return null;
        }
        $resource = $event->getArg('resource', 0);
        $status = $event->getArg('status', 1, new LiteralIntegerType(200));
        if (! $resource instanceof ObjectType || ! $resource->isInstanceOf(JsonResource::class)) {
            throw new \LogicException('Resource envelope requires a native typed resource');
        }

        return new Generic(JsonResponse::class, [new KeyedArrayType([
            new ArrayItemType_('success', new LiteralBooleanType(true)),
            new ArrayItemType_('data', $resource),
        ]), $status, new ArrayType]);
    }
}
