<?php

declare(strict_types=1);

namespace App\Modules\Auth\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $family_id
 * @property string $user_id
 * @property string $token_hash
 * @property CarbonImmutable $expires_at
 * @property ?CarbonImmutable $consumed_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class RefreshToken extends Model
{
    use HasUuids;

    protected $table = 'refresh_tokens';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'expires_at' => 'immutable_datetime',
            'consumed_at' => 'immutable_datetime',
        ];
    }
}
