<?php

declare(strict_types=1);

namespace App\Modules\Roles\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $role_id
 * @property string $permission_id
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class RolePermission extends Model
{
    protected $table = 'role_permissions';

    protected $guarded = [];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $primaryKey = 'role_id';

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime'];
    }
}
