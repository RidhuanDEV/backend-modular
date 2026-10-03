<?php

declare(strict_types=1);

namespace App\Infrastructure\Outbox;

use App\Modules\Notifications\Data\EmailStatus;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Notifications\Models\Notification;
use App\Support\Config\Settings;
use App\Support\Time\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Outbox
{
    public function __construct(private readonly Clock $clock) {}

    public function claim(): ?Lease
    {
        return DB::transaction(function (): ?Lease {
            $now = $this->clock->now();
            $instant = $now->format('Y-m-d H:i:s.u');
            $job = EmailJob::query()
                ->where('status', 'PENDING')
                ->where('available_at', '<=', $instant)
                ->where(
                    fn($query) => $query
                        ->whereNull('lease_until')
                        ->orWhere('lease_until', '<=', $instant),
                )
                ->orderBy('available_at')
                ->orderBy('id')
                ->lock('FOR UPDATE SKIP LOCKED')
                ->first();
            if ($job === null) {
                return null;
            }
            if (
                $job->attempts >=
                Settings::integer('backend.worker.attempts', 1, 5)
            ) {
                $job->status = 'FAILED';
                $job->completed_at = $now;
                $job->lease_id = null;
                $job->lease_until = null;
                $job->save();
                Notification::query()
                    ->whereKey($job->notification_id)
                    ->update(['email_status' => EmailStatus::Failed]);

                return null;
            }
            $job->attempts++;
            $job->lease_id = Str::uuid()->toString();
            $job->lease_until = $now->addSeconds(
                Settings::integer('backend.worker.lease', 10, 600),
            );
            $job->save();

            return new Lease($job->id, $job->lease_id);
        });
    }

    public function renew(Lease $lease): bool
    {
        $now = $this->clock->now();

        return EmailJob::query()
            ->whereKey($lease->jobId)
            ->where('lease_id', $lease->leaseId)
            ->where('status', 'PENDING')
            ->where('lease_until', '>', $now)
            ->update([
                'lease_until' => $now->addSeconds(
                    Settings::integer('backend.worker.lease', 10, 600),
                ),
            ]) === 1;
    }

    public function complete(Lease $lease, bool $delivered): bool
    {
        return DB::transaction(function () use ($lease, $delivered): bool {
            $job = EmailJob::query()
                ->whereKey($lease->jobId)
                ->where('lease_id', $lease->leaseId)
                ->where('status', 'PENDING')
                ->where('lease_until', '>', $this->clock->now())
                ->lockForUpdate()
                ->first();
            if ($job === null) {
                return false;
            }
            $terminal =
                $delivered ||
                $job->attempts >=
                    Settings::integer('backend.worker.attempts', 1, 5);
            $job->status = $delivered
                ? 'SENT'
                : ($terminal
                    ? 'FAILED'
                    : 'PENDING');
            $job->completed_at = $terminal ? $this->clock->now() : null;
            $delay = [5, 30, 120, 600][$job->attempts - 1] ?? 600;
            $job->available_at = $this->clock->now()->addSeconds($delay);
            $job->lease_id = null;
            $job->lease_until = null;
            $job->save();
            if ($terminal) {
                Notification::query()
                    ->whereKey($job->notification_id)
                    ->update([
                        'email_status' => $delivered
                            ? EmailStatus::Sent
                            : EmailStatus::Failed,
                    ]);
            }

            return true;
        });
    }
}
