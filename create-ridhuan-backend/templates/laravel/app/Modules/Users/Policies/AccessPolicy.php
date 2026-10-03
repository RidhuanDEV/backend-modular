<?php

declare(strict_types=1);

namespace App\Modules\Users\Policies;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Support\Http\ApiException;
use Illuminate\Support\Facades\DB;

final class AccessPolicy
{
    public function permits(User $user, string $name): bool
    {
        return DB::table('role_permissions')->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')->where('role_id', $user->role_id)->where('permissions.name', $name)->exists();
    }

    /** @param list<string> $ids */
    public function within(User $actor, array $ids): void
    {
        $role = Role::query()->with('permissions')->find($actor->role_id) ?? throw new ApiException(403, 'Actor role is unavailable');
        $owned = $role->permissions->map(fn (Permission $permission): string => $permission->id)->all();
        if (array_diff($ids, $owned) !== []) {
            throw new ApiException(403, 'Cannot grant or modify privileges outside actor permissions');
        }
    }

    public function roleWithin(User $actor, string $id): void
    {
        $role = Role::query()->with('permissions')->find($id);
        if ($role === null) {
            throw new ApiException(404, 'Role not found');
        }
        $this->within($actor, array_values($role->permissions->map(fn (Permission $p): string => $p->id)->all()));
    }
}
