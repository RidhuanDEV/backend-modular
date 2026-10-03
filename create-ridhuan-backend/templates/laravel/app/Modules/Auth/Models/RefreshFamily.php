<?php

declare(strict_types=1);

namespace App\Modules\Auth\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $user_id
 * @property CarbonImmutable $expires_at
 * @property ?CarbonImmutable $revoked_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class RefreshFamily extends Model
{
    use HasUuids;

    protected $table = 'refresh_families';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }
}
