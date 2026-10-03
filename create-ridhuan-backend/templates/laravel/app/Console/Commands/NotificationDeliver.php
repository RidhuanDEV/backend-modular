<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Modules\Notifications\Models\EmailJob;
use App\Support\Config\Settings;
use App\Support\Observability\Telemetry;
use Illuminate\Console\Command;
use Illuminate\Mail\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

final class NotificationDeliver extends Command
{
    protected $signature = 'notifications:deliver {job} {lease}';

    protected $description = 'Internal fenced child delivery; never completes SQL jobs';

    protected $hidden = true;

    public function handle(): int
    {
        $jobId = $this->argument('job');
        $leaseId = $this->argument('lease');
        $delivered = false;
        $telemetry = app(Telemetry::class);
        $scope = $telemetry->start('email.deliver');
        $started = microtime(true);
        try {
            if (! Str::isUuid($jobId) || ! Str::isUuid($leaseId) || ! Settings::boolean('backend.smtp')) {
                throw new \RuntimeException('Invalid child context');
            }
            $job = EmailJob::query()->whereKey($jobId)->where('lease_id', $leaseId)->where('status', 'PENDING')->where('lease_until', '>', now('UTC'))->first();
            if ($job === null) {
                throw new \RuntimeException('Lost lease');
            }
            DB::disconnect();
            Mail::raw($job->body, function (Message $message) use ($job): void {
                $message->to($job->recipient)->subject($job->title);
            });
            $delivered = true;
        } catch (Throwable) { /* Bounded IPC reports outcome; SMTP details stay private. */
        }
        $telemetry->finish($scope, 'email.deliver', $delivered ? 200 : 500, microtime(true) - $started);
        $this->output->write(json_encode(['delivered' => $delivered], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }
}
