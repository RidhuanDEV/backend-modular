<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $notification_id
 * @property string $recipient
 * @property string $title
 * @property string $body
 * @property string $status
 * @property int $attempts
 * @property CarbonImmutable $available_at
 * @property ?string $lease_id
 * @property ?CarbonImmutable $lease_until
 * @property ?CarbonImmutable $completed_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class EmailJob extends Model
{
    use HasUuids;

    protected $table = 'email_jobs';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime', 'attempts' => 'integer', 'available_at' => 'immutable_datetime', 'lease_until' => 'immutable_datetime', 'completed_at' => 'immutable_datetime'];
    }
}
