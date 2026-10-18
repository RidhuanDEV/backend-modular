<?php

declare(strict_types=1);

namespace App\Modules\Users\Policies;

use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Support\Http\ApiException;
use App\Support\Time\Clock;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

final class AccessPolicy
{
    /** The seeded administrator role; access is decided by RBAC, only uploads trust it by name. */
    public const ROOT_ROLE = 'admin';

    public const DEFAULT_ROLE = 'user';

    /**
     * Code depends on these by name (registration, upload ownership, route permissions), so they
     * cannot be renamed, deleted or recreated; renaming a permission would mint access.
     */
    public const SYSTEM_ROLES = [self::ROOT_ROLE, self::DEFAULT_ROLE];

    public const SYSTEM_PERMISSIONS = [
        'manage_users',
        'manage_roles',
        'manage_permissions',
        'manage_uploads',
        'manage_notifications',
    ];

    public function __construct(private readonly Clock $clock) {}

    public function permits(User $user, string $name): bool
    {
        return DB::table('role_permissions')
            ->join(
                'permissions',
                'permissions.id',
                '=',
                'role_permissions.permission_id',
            )
            ->where('role_id', $user->role_id)
            ->where('permissions.name', $name)
            ->exists();
    }

    /** @param list<string> $names */
    public static function notSystemName(
        array $names,
        string $kind,
        ?string $name,
    ): void {
        if ($name !== null && in_array($name, $names, true)) {
            throw new ApiException(
                403,
                "System {$kind} '{$name}' cannot be created, renamed or deleted",
            );
        }
    }

    public function isRoot(User $actor): bool
    {
        return Role::query()
            ->whereKey($actor->role_id)
            ->where('name', self::ROOT_ROLE)
            ->exists();
    }

    /** @param list<string> $ids */
    public function within(User $actor, array $ids): void
    {
        $role =
            Role::query()->with('permissions')->find($actor->role_id) ??
            throw new ApiException(403, 'Actor role is unavailable');
        $owned = $role->permissions
            ->map(fn(Permission $permission): string => $permission->id)
            ->all();
        if (array_diff($ids, $owned) !== []) {
            throw new ApiException(
                403,
                'Cannot grant or modify privileges outside actor permissions',
            );
        }
    }

    public function roleWithin(User $actor, string $id): void
    {
        $role = Role::query()->with('permissions')->find($id);
        if ($role === null) {
            throw new ApiException(404, 'Role not found');
        }
        $this->within(
            $actor,
            array_values(
                $role->permissions
                    ->map(fn(Permission $p): string => $p->id)
                    ->all(),
            ),
        );
    }

    /**
     * Lockout guard: every system permission must stay held by at least one active user,
     * or nobody could grant it again. Locks the system permission rows so concurrent RBAC
     * mutations serialize, and returns a check to run after the mutation inside the same
     * transaction. Only permissions that become unheld fail.
     *
     * @return \Closure(): void
     */
    public function guardSystemPermissionHolders(): \Closure
    {
        Permission::query()
            ->whereIn('name', self::SYSTEM_PERMISSIONS)
            ->orderBy('name')
            ->lockForUpdate()
            ->get(['id']);
        $before = $this->unheldSystemPermissions();

        return function () use ($before): void {
            $lost = array_values(
                array_diff($this->unheldSystemPermissions(), $before),
            );
            if ($lost !== []) {
                throw new ApiException(
                    403,
                    "Change would leave no active user holding '{$lost[0]}'",
                );
            }
        };
    }

    /**
     * RBAC only: a new permission goes to every role that manages permissions, so its
     * creator and other permission managers can hand it out without a role-name exemption.
     */
    public function grantToPermissionManagers(Permission $permission): void
    {
        $managers = Role::query()
            ->whereHas('permissions', function (Builder $query): void {
                $query->where('name', 'manage_permissions');
            })
            ->get();
        foreach ($managers as $role) {
            $role->permissions()->syncWithoutDetaching([$permission->id]);
        }
    }

    /** @return list<string> */
    private function unheldSystemPermissions(): array
    {
        return array_values(
            Permission::query()
                ->whereIn('name', self::SYSTEM_PERMISSIONS)
                ->whereNotExists(function (QueryBuilder $query): void {
                    $query
                        ->select(DB::raw('1'))
                        ->from('role_permissions')
                        ->join(
                            'users',
                            'users.role_id',
                            '=',
                            'role_permissions.role_id',
                        )
                        ->whereColumn(
                            'role_permissions.permission_id',
                            'permissions.id',
                        )
                        ->whereNull('users.deleted_at');
                })
                ->get()
                ->map(fn(Permission $p): string => $p->name)
                ->all(),
        );
    }

    /** Access changed: every refresh session must re-authenticate under the new rules. */
    public function revokeSessions(string $userId): void
    {
        RefreshFamily::query()
            ->where('user_id', $userId)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => $this->clock->now()]);
    }
}
