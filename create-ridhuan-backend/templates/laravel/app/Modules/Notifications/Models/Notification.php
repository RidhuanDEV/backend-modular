<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Models;

use App\Modules\Notifications\Data\EmailStatus;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $recipient_id
 * @property ?string $actor_id
 * @property int $sequence
 * @property string $title
 * @property string $body
 * @property EmailStatus $email_status
 * @property ?CarbonImmutable $read_at
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 */
final class Notification extends Model
{
    use HasUuids;

    protected $table = 'notifications';

    protected $guarded = [];

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime', 'sequence' => 'integer', 'email_status' => EmailStatus::class, 'read_at' => 'immutable_datetime'];
    }
}
