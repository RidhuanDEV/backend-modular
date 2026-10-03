<?php

declare(strict_types=1);

namespace App\Modules\Users\Services;

use App\Modules\Users\Data\CreateUser;
use App\Modules\Users\Data\UpdateUser;
use App\Modules\Users\Data\UserQuery;
use App\Modules\Users\Models\User;
use App\Modules\Users\Policies\AccessPolicy;
use App\Support\Audit\Audit;
use App\Support\Http\ApiException;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class UserService
{
    public function __construct(private readonly AccessPolicy $policy, private readonly Audit $audit) {}

    /** @return LengthAwarePaginator<int, User> */
    public function list(UserQuery $query): LengthAwarePaginator
    {
        $builder = User::query()->with('role.permissions');
        if ($query->search !== null) {
            $builder->where('email', 'like', '%'.$query->search.'%');
        }
        $sort = match ($query->sortBy) {
            'email' => 'email', 'updatedAt' => 'updated_at', default => 'created_at'
        };

        $direction = match ($query->orderBy) {
            'asc' => 'asc', 'desc' => 'desc', default => throw new \InvalidArgumentException('Invalid sort direction'),
        };

        return $builder->orderBy($sort, $direction)->orderBy('id')->paginate($query->limit, ['*'], 'page', $query->page);
    }

    public function get(string $id): User
    {
        return User::query()->with('role.permissions')->find($id) ?? throw new ApiException(404, 'User not found');
    }

    public function create(CreateUser $data, User $actor): User
    {
        $hash = Hash::make($data->password);
        $id = DB::transaction(function () use ($data, $actor, $hash): string {
            $this->policy->roleWithin($actor, $data->roleId);
            if (User::withTrashed()->where('email', $data->email)->exists()) {
                throw new ApiException(409, 'Email already registered');
            }
            $user = User::query()->create(['email' => $data->email, 'password' => $hash, 'role_id' => $data->roleId]);
            $this->audit->write('CREATE', 'user', $user->id, $actor->id, after: ['id' => $user->id, 'roleId' => $user->role_id]);

            return $user->id;
        });

        return $this->get($id);
    }

    public function update(string $id, UpdateUser $data, User $actor): User
    {
        DB::transaction(function () use ($id, $data, $actor): void {
            $user = User::query()->whereKey($id)->lockForUpdate()->first() ?? throw new ApiException(404, 'User not found');
            $this->policy->roleWithin($actor, $user->role_id);
            if ($data->roleId !== null) {
                $this->policy->roleWithin($actor, $data->roleId);
            }
            $before = ['roleId' => $user->role_id];
            if ($data->email !== null) {
                if (User::withTrashed()->where('email', $data->email)->where('id', '!=', $id)->exists()) {
                    throw new ApiException(409, 'Email already registered');
                }
                $user->email = $data->email;
            }
            if ($data->roleId !== null) {
                $user->role_id = $data->roleId;
            }
            $user->save();
            $this->audit->write('UPDATE', 'user', $id, $actor->id, $before, ['roleId' => $user->role_id]);
        });

        return $this->get($id);
    }

    public function delete(string $id, User $actor): void
    {
        DB::transaction(function () use ($id, $actor): void {
            $user = User::query()->whereKey($id)->lockForUpdate()->first() ?? throw new ApiException(404, 'User not found');
            $this->policy->roleWithin($actor, $user->role_id);
            if ($id === $actor->id) {
                throw new ApiException(403, 'Cannot delete yourself');
            }
            $user->delete();
            $this->audit->write('DELETE', 'user', $id, $actor->id, ['roleId' => $user->role_id]);
        });
    }
}
