<?php

declare(strict_types=1);

namespace App\Modules\Permissions\Services;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Users\Models\User;
use App\Support\Audit\Audit;
use App\Support\Http\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

final class PermissionService
{
    public function __construct(private readonly Audit $audit) {}

    /** @return Collection<int, Permission> */
    public function list(): Collection
    {
        return Permission::query()->orderBy('name')->get();
    }

    public function get(string $id): Permission
    {
        return Permission::query()->find($id) ?? throw new ApiException(404, 'Permission not found');
    }

    public function create(string $name, User $actor): Permission
    {
        return DB::transaction(function () use ($name, $actor): Permission {
            if (Permission::query()->where('name', $name)->exists()) {
                throw new ApiException(409, 'Permission exists');
            }
            $role = Permission::query()->create(['name' => $name]);
            $this->audit->write('CREATE', 'permission', $role->id, $actor->id, after: ['name' => $name]);

            return $role;
        });
    }

    public function update(string $id, ?string $name, User $actor): Permission
    {
        DB::transaction(function () use ($id, $name, $actor): void {
            $role = Permission::query()->whereKey($id)->lockForUpdate()->first() ?? throw new ApiException(404, 'Permission not found');
            $before = ['name' => $role->name];
            if ($name !== null) {
                if (Permission::query()->where('name', $name)->where('id', '!=', $id)->exists()) {
                    throw new ApiException(409, 'Permission exists');
                }
                $role->name = $name;
                $role->save();
            }
            $this->audit->write('UPDATE', 'permission', $id, $actor->id, $before, ['name' => $role->name]);
        });

        return $this->get($id);
    }

    public function delete(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $role = Permission::query()->whereKey($id)->lockForUpdate()->first() ?? throw new ApiException(404, 'Permission not found');
            $role->delete();
            $this->audit->write('DELETE', 'permission', $id, $actor->id, ['name' => $role->name]);
        });
    }
}
