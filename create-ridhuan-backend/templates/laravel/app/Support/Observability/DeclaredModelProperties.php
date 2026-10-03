<?php

declare(strict_types=1);

namespace App\Support\Observability;

use Dedoc\Scramble\Infer\Contracts\ClassDefinition;
use Dedoc\Scramble\Infer\Definition\ClassPropertyDefinition;
use Dedoc\Scramble\Infer\Extensions\Event\PropertyFetchEvent;
use Dedoc\Scramble\Infer\Extensions\PropertyTypeExtension;
use Dedoc\Scramble\Support\Type\ArrayType;
use Dedoc\Scramble\Support\Type\MixedType;
use Dedoc\Scramble\Support\Type\ObjectType;
use Dedoc\Scramble\Support\Type\StringType;
use Dedoc\Scramble\Support\Type\Type;
use Illuminate\Database\Eloquent\Model;

/** Model contracts are declared beside their native casts and provider migrations. */
final class DeclaredModelProperties implements PropertyTypeExtension
{
    public function shouldHandle(ObjectType $type): bool
    {
        return str_starts_with($type->name, 'App\\') &&
            $type->isInstanceOf(Model::class);
    }

    public function getPropertyType(PropertyFetchEvent $event): Type
    {
        $definition = $event->getDefinition();
        if (!($definition instanceof ClassDefinition)) {
            throw new \LogicException('Model class definition is required');
        }
        $property = $definition->getData()->getPropertyDefinition($event->name);
        if (
            $property === null &&
            in_array(
                $event->name,
                ['relations', 'attributes', 'casts', 'original', 'changes'],
                true,
            )
        ) {
            return new ArrayType(new MixedType(), new StringType());
        }
        if (!($property instanceof ClassPropertyDefinition)) {
            throw new \LogicException(
                'Public model property must declare its source contract: ' .
                    $event->name,
            );
        }

        return $property->type;
    }
}
