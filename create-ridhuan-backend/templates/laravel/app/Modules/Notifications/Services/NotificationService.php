<?php

declare(strict_types=1);

namespace App\Modules\Notifications\Services;

use App\Modules\Notifications\Data\CreateNotification;
use App\Modules\Notifications\Data\EmailStatus;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Models\NotificationCounter;
use App\Modules\Users\Models\User;
use App\Support\Audit\Audit;
use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use App\Support\Time\Clock;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class NotificationService
{
    public function __construct(
        private readonly Audit $audit,
        private readonly Clock $clock,
    ) {}

    public function create(CreateNotification $data, User $actor): Notification
    {
        return DB::transaction(function () use ($data, $actor): Notification {
            // Recipient lock serializes counter initialization and snapshots its immutable address.
            $recipient =
                User::query()
                    ->whereKey($data->recipientId)
                    ->lockForUpdate()
                    ->first() ??
                throw new ApiException(404, 'Recipient not found');
            $counter = NotificationCounter::query()->firstOrCreate(
                ['recipient_id' => $recipient->id],
                ['sequence' => 0],
            );
            $counter->sequence++;
            $counter->save();
            $smtp = Settings::boolean('backend.smtp');
            $notification = Notification::query()->create([
                'recipient_id' => $recipient->id,
                'actor_id' => $actor->id,
                'sequence' => $counter->sequence,
                'title' => $data->title,
                'body' => $data->body,
                'email_status' => $data->sendEmail
                    ? ($smtp
                        ? EmailStatus::Pending
                        : EmailStatus::Failed)
                    : EmailStatus::NotRequested,
            ]);
            if ($data->sendEmail && $smtp) {
                EmailJob::query()->create([
                    'notification_id' => $notification->id,
                    'recipient' => $recipient->email,
                    'title' => $data->title,
                    'body' => $data->body,
                    'available_at' => $this->clock->now(),
                ]);
            }
            $this->audit->write(
                'CREATE',
                'notification',
                $notification->id,
                $actor->id,
                after: [
                    'id' => $notification->id,
                    'emailRequested' => $data->sendEmail,
                ],
            );

            return $notification;
        });
    }

    public function cursor(User $actor, ?string $id): ?int
    {
        if ($id === null) {
            return null;
        }
        if (!Str::isUuid($id)) {
            throw new ApiException(400, 'Invalid notification cursor');
        }

        $notification =
            Notification::query()
                ->whereKey($id)
                ->where('recipient_id', $actor->id)
                ->first() ??
            throw new ApiException(400, 'Unknown notification cursor');

        return $notification->sequence;
    }

    /** @return Collection<int, Notification> */
    public function page(User $actor, ?int $before): Collection
    {
        return Notification::query()
            ->where('recipient_id', $actor->id)
            ->when(
                $before !== null,
                fn($q) => $q->where('sequence', '<', $before),
            )
            ->orderByDesc('sequence')
            ->limit(51)
            ->get();
    }

    /** @return Collection<int, Notification>|null */
    public function batch(User $actor, ?int $after, bool $unread): ?Collection
    {
        if (!User::query()->whereKey($actor->id)->exists()) {
            return null;
        }

        return Notification::query()
            ->where('recipient_id', $actor->id)
            ->when(
                $after !== null,
                fn($q) => $q->where('sequence', '>', $after),
            )
            ->when($unread, fn($q) => $q->whereNull('read_at'))
            ->orderBy('sequence')
            ->limit(50)
            ->get();
    }

    public function read(string $id, User $actor): Notification
    {
        return DB::transaction(function () use ($id, $actor): Notification {
            $item =
                Notification::query()
                    ->whereKey($id)
                    ->where('recipient_id', $actor->id)
                    ->lockForUpdate()
                    ->first() ??
                throw new ApiException(404, 'Notification not found');
            $before = ['readAt' => $item->read_at?->toIso8601ZuluString()];
            $item->read_at ??= $this->clock->now();
            $item->save();
            $this->audit->write(
                'UPDATE',
                'notification',
                $id,
                $actor->id,
                $before,
                ['readAt' => $item->read_at->toIso8601ZuluString()],
            );

            return $item;
        });
    }
}
