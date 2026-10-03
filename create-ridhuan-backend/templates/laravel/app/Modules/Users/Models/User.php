<?php

declare(strict_types=1);

namespace App\Modules\Users\Models;

use App\Modules\Roles\Models\Role;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;

/**
 * @property string $id
 * @property string $email
 * @property string $password
 * @property string $role_id
 * @property Role|null $role
 * @property ?CarbonImmutable $deleted_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class User extends Authenticatable
{
    use HasUuids;
    use SoftDeletes;

    protected $table = 'users';

    protected $guarded = [];

    protected $hidden = ['password'];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime', 'deleted_at' => 'immutable_datetime'];
    }

    /** @return BelongsTo<Role, $this> */
    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class);
    }
}
