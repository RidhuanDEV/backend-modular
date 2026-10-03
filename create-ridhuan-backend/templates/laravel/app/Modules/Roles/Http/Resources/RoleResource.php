<?php

declare(strict_types=1);

namespace App\Modules\Roles\Http\Resources;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property Role $resource */
final class RoleResource extends JsonResource
{
    public function __construct(private readonly Role $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,name:string,createdAt:string,updatedAt:string,permissions:array<int,array{permission:array{id:string,name:string}}> } */
    public function toArray(Request $request): array
    {
        $m = $this->model;

        return ['id' => $m->id, 'name' => $m->name, 'createdAt' => $m->created_at->toIso8601ZuluString('microsecond'), 'updatedAt' => $m->updated_at->toIso8601ZuluString('microsecond'), 'permissions' => $m->permissions->map(fn (Permission $p): array => ['permission' => ['id' => $p->id, 'name' => $p->name]])->all()];
    }
}
