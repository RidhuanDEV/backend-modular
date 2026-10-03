<?php

declare(strict_types=1);

namespace App\Modules\Roles\Models;

use App\Modules\Permissions\Models\Permission;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * @property string $id
 * @property string $name
 * @property Collection<int, Permission> $permissions
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class Role extends Model
{
    use HasUuids;

    protected $table = 'roles';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** @return BelongsToMany<Permission, $this> */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(
            Permission::class,
            'role_permissions',
        )->withTimestamps();
    }
}
