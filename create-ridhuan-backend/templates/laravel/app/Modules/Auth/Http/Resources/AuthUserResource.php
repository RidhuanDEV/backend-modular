<?php

declare(strict_types=1);

namespace App\Modules\Auth\Http\Resources;

use App\Modules\Users\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @property User $resource */
final class AuthUserResource extends JsonResource
{
    public function __construct(private readonly User $model)
    {
        parent::__construct($model);
    }

    /** @return array{id:string,email:string,roleId:string,createdAt:string,updatedAt:string} */
    public function toArray(Request $request): array
    {
        $m = $this->model;

        return ['id' => $m->id, 'email' => $m->email, 'roleId' => $m->role_id, 'createdAt' => $m->created_at->toIso8601ZuluString('microsecond'), 'updatedAt' => $m->updated_at->toIso8601ZuluString('microsecond')];
    }
}
