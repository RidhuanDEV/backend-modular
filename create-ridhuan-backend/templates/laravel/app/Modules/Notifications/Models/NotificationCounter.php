<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $recipient_id
 * @property int $sequence
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class NotificationCounter extends Model
{
    protected $table = 'notification_counters';

    protected $guarded = [];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $primaryKey = 'recipient_id';

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime', 'sequence' => 'integer'];
    }
}
