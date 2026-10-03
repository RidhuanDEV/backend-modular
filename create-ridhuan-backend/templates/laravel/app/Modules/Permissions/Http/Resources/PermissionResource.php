<?php

declare(strict_types=1);

namespace App\Modules\Permissions\Http\Resources;

use App\Modules\Permissions\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property Permission $resource */
final class PermissionResource extends JsonResource
{
    public function __construct(private readonly Permission $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,name:string,createdAt:string,updatedAt:string} */
    public function toArray(Request $request): array
    {
        $m = $this->model;

        return ['id' => $m->id, 'name' => $m->name, 'createdAt' => $m->created_at->toIso8601ZuluString('microsecond'), 'updatedAt' => $m->updated_at->toIso8601ZuluString('microsecond')];
    }
}
