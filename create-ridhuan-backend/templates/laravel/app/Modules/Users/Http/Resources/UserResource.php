<?php

declare(strict_types=1);

namespace App\Modules\Users\Http\Resources;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Users\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property User $resource */
final class UserResource extends JsonResource
{
    public function __construct(private readonly User $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,email:string,roleId:string,createdAt:string,updatedAt:string,role:array{id:string,name:string,permissions:array<int,array{id:string,name:string}>}} */
    public function toArray(Request $request): array
    {
        $m = $this->model;
        $role = $m->role ?? throw new \LogicException('User role is required');

        return ['id' => $m->id, 'email' => $m->email, 'roleId' => $m->role_id, 'createdAt' => $m->created_at->toIso8601ZuluString('microsecond'), 'updatedAt' => $m->updated_at->toIso8601ZuluString('microsecond'), 'role' => ['id' => $role->id, 'name' => $role->name, 'permissions' => $role->permissions->map(fn (Permission $p): array => ['id' => $p->id, 'name' => $p->name])->all()]];
    }

    /**
     * @param  list<string>|null  $fields
     * @return array{id?:string,email?:string,roleId?:string,createdAt?:string,updatedAt?:string,role?:array{id:string,name:string,permissions:array<int,array{id:string,name:string}>}}
     */
    public function project(?array $fields): array
    {
        $values = $this->toArray(request());

        return $fields === null ? $values : array_intersect_key($values, array_flip($fields));
    }
}
