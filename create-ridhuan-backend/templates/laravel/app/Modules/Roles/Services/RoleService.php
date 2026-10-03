<?php

declare(strict_types=1);

namespace App\Modules\Roles\Services;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Modules\Users\Policies\AccessPolicy;
use App\Support\Audit\Audit;
use App\Support\Http\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

final class RoleService
{
    public function __construct(
        private readonly AccessPolicy $policy,
        private readonly Audit $audit,
    ) {}

    /** @return Collection<int, Role> */
    public function list(): Collection
    {
        return Role::query()->with('permissions')->orderBy('name')->get();
    }

    public function get(string $id): Role
    {
        return Role::query()->with('permissions')->find($id) ??
            throw new ApiException(404, 'Role not found');
    }

    public function create(string $name, User $actor): Role
    {
        return DB::transaction(function () use ($name, $actor): Role {
            if (Role::query()->where('name', $name)->exists()) {
                throw new ApiException(409, 'Role exists');
            }
            $role = Role::query()->create(['name' => $name]);
            $this->audit->write(
                'CREATE',
                'role',
                $role->id,
                $actor->id,
                after: ['name' => $name],
            );

            return $role->load('permissions');
        });
    }

    public function update(string $id, ?string $name, User $actor): Role
    {
        DB::transaction(function () use ($id, $name, $actor): void {
            $role =
                Role::query()->whereKey($id)->lockForUpdate()->first() ??
                throw new ApiException(404, 'Role not found');
            $this->policy->roleWithin($actor, $id);
            $before = ['name' => $role->name];
            if ($name !== null) {
                if (
                    Role::query()
                        ->where('name', $name)
                        ->where('id', '!=', $id)
                        ->exists()
                ) {
                    throw new ApiException(409, 'Role exists');
                }
                $role->name = $name;
                $role->save();
            }
            $this->audit->write('UPDATE', 'role', $id, $actor->id, $before, [
                'name' => $role->name,
            ]);
        });

        return $this->get($id);
    }

    public function delete(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $role =
                Role::query()->whereKey($id)->lockForUpdate()->first() ??
                throw new ApiException(404, 'Role not found');
            $this->policy->roleWithin($actor, $id);
            if (User::withTrashed()->where('role_id', $id)->exists()) {
                throw new ApiException(409, 'Role still assigned');
            }
            $role->delete();
            $this->audit->write('DELETE', 'role', $id, $actor->id, [
                'name' => $role->name,
            ]);
        });
    }

    /** @param list<string> $ids */
    public function assign(string $id, array $ids, User $actor): Role
    {
        DB::transaction(function () use ($id, $ids, $actor): void {
            $role =
                Role::query()->whereKey($id)->lockForUpdate()->first() ??
                throw new ApiException(404, 'Role not found');
            $this->policy->roleWithin($actor, $id);
            $this->policy->within($actor, $ids);
            if (
                Permission::query()->whereIn('id', $ids)->count() !==
                count($ids)
            ) {
                throw new ApiException(404, 'Permission not found');
            }
            $role->permissions()->sync($ids);
            $this->audit->write(
                'ASSIGN_PERMISSIONS',
                'role',
                $id,
                $actor->id,
                after: ['permissionIds' => $ids],
            );
        });

        return $this->get($id);
    }
}
