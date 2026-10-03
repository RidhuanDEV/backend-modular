<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Infrastructure\Outbox\DeliveryChild;
use App\Infrastructure\Outbox\Outbox;
use App\Support\Config\Settings;
use App\Support\Observability\Telemetry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\Process\Process;
use Throwable;

final class NotificationsWork extends Command
{
    protected $signature = 'notifications:work {--once} {--stop-file=}';

    protected $description = 'SQL outbox supervisor; parent renews leases while child SMTP blocks';

    private bool $stopping = false;

    public function handle(Outbox $outbox, Telemetry $telemetry): int
    {
        Settings::validate();
        if (function_exists('pcntl_async_signals')) {
            pcntl_async_signals(true);
            pcntl_signal(SIGTERM, function (): void {
                $this->stopping = true;
            });
            pcntl_signal(SIGINT, function (): void {
                $this->stopping = true;
            });
        }
        if (function_exists('sapi_windows_set_ctrl_handler')) {
            sapi_windows_set_ctrl_handler(function (int $event): void {
                $this->stopping = true;
            });
        }
        $stopFile = $this->option('stop-file');
        /** @var list<DeliveryChild> $children */ $children = [];
        $shutdownAt = null;
        $renew = Settings::integer('backend.worker.renew', 1, 120);
        if ($renew * 2 >= Settings::integer('backend.worker.lease', 10, 600)) {
            throw new \InvalidArgumentException(
                'Worker lease must exceed two renewal periods',
            );
        }
        try {
            while (true) {
                if (is_string($stopFile) && is_file($stopFile)) {
                    $this->stopping = true;
                }
                if ($this->stopping && $shutdownAt === null) {
                    $shutdownAt = microtime(true) + 10;
                }
                $running = [];
                foreach ($children as $child) {
                    try {
                        $child->process->checkTimeout();
                        if ($child->process->isRunning()) {
                            if (microtime(true) >= $child->renewAt) {
                                if (!$outbox->renew($child->lease)) {
                                    $telemetry->event('outbox.lease.lost');
                                    $child->process->stop(1);

                                    continue;
                                }
                                $telemetry->event('outbox.lease.renewed');
                                $child->renewAt = microtime(true) + $renew;
                            }
                            $running[] = $child;

                            continue;
                        }
                        $output = $child->process->getOutput();
                        $data =
                            strlen($output) <= 256
                                ? json_decode($output, true)
                                : null;
                        $delivered =
                            $child->process->isSuccessful() &&
                            is_array($data) &&
                            ($data['delivered'] ?? null) === true;
                        $scope = $telemetry->start('outbox.complete');
                        $completed = $outbox->complete(
                            $child->lease,
                            $delivered,
                        );
                        $telemetry->event(
                            $completed
                                ? ($delivered
                                    ? 'outbox.sent'
                                    : 'outbox.delivery_failed')
                                : 'outbox.fenced',
                        );
                        $telemetry->finish(
                            $scope,
                            'outbox.complete',
                            !$completed ? 409 : ($delivered ? 200 : 500),
                            0.0,
                        );
                    } catch (Throwable $error) {
                        $child->process->stop(1);
                        Log::warning('outbox_child_failed', [
                            'type' => $error::class,
                        ]);
                        // Do not complete an unconfirmed lease; expiration permits bounded recovery.
                    } finally {
                        Log::flushSharedContext();
                    }
                }
                $children = $running;
                if (!$this->stopping && Settings::boolean('backend.smtp')) {
                    while (
                        count($children) <
                        Settings::integer('backend.worker.concurrency', 1, 16)
                    ) {
                        $lease = $outbox->claim();
                        if ($lease === null) {
                            break;
                        }
                        $telemetry->event('outbox.attempts');
                        $process = new Process(
                            [
                                PHP_BINARY,
                                base_path('artisan'),
                                'notifications:deliver',
                                $lease->jobId,
                                $lease->leaseId,
                                '--no-ansi',
                            ],
                            base_path(),
                        );
                        $process->setTimeout(
                            Settings::integer('backend.worker.timeout', 1, 600),
                        );
                        $process->start();
                        $child = new DeliveryChild($lease, $process);
                        $child->renewAt = microtime(true) + $renew;
                        $children[] = $child;
                    }
                }
                if ($this->option('once') === true && $children === []) {
                    break;
                }
                if (
                    $this->stopping &&
                    ($children === [] ||
                        ($shutdownAt !== null &&
                            microtime(true) >= $shutdownAt))
                ) {
                    break;
                }
                DB::disconnect();
                usleep(200000);
            }
        } finally {
            foreach ($children as $child) {
                $child->process->stop(1);
            }
            DB::disconnect();
        }

        return self::SUCCESS;
    }
}
