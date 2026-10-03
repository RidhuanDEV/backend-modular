<?php

declare(strict_types=1);

namespace Tests\Integration;

use App\Modules\Auth\Data\Credentials;
use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Auth\Models\RefreshToken;
use App\Modules\Auth\Services\AuthService;
use App\Modules\Notifications\Models\Notification;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;

final class ProcessTest extends DatabaseCase
{
    public function test_concurrent_cleanup_respects_batch_and_removes_distinct_ended_families(): void
    {
        for ($i = 0; $i < 60; $i++) {
            RefreshFamily::query()->create([
                'user_id' => $this->admin->id,
                'expires_at' => now('UTC')->subDays(60),
                'revoked_at' => now('UTC')->subDays(60),
            ]);
        }
        $processes = [];
        try {
            for ($i = 0; $i < 2; $i++) {
                $process = new Process(
                    [
                        PHP_BINARY,
                        base_path('artisan'),
                        'backend:cleanup',
                        '--apply',
                    ],
                    base_path(),
                    ['CLEANUP_BATCH_SIZE' => '17'],
                );
                $process->setTimeout(30);
                $process->start();
                $processes[] = $process;
            }
            foreach ($processes as $process) {
                $process->wait();
                self::assertTrue(
                    $process->isSuccessful(),
                    $process->getErrorOutput(),
                );
                $result = json_decode(
                    trim($process->getOutput()),
                    true,
                    flags: JSON_THROW_ON_ERROR,
                );
                self::assertIsArray($result);
                self::assertSame(17, $result['families']);
            }
            self::assertSame(26, RefreshFamily::query()->count());
        } finally {
            foreach ($processes as $process) {
                $process->stop(1);
            }
        }
    }

    public function test_worker_stops_gracefully_on_windows_and_linux_without_polling_when_smtp_is_off(): void
    {
        $scratch =
            sys_get_temp_dir() . '/laravel-stop-' . Str::uuid()->toString();
        mkdir($scratch, 0700, true);
        $stop = $scratch . '/stop';
        $process = new Process(
            [
                PHP_BINARY,
                base_path('artisan'),
                'notifications:work',
                '--stop-file=' . $stop,
            ],
            base_path(),
            [
                'SMTP_ENABLED' => 'false',
                'DB_HOST' => '127.0.0.1',
                'DB_PORT' => '1',
            ],
        );
        $process->setTimeout(15);
        try {
            $process->start();
            usleep(750000);
            self::assertTrue(
                $process->isRunning(),
                'SMTP-off worker should idle without a SQL connection',
            );
            file_put_contents($stop, 'stop');
            $started = microtime(true);
            $process->wait();
            self::assertTrue(
                $process->isSuccessful(),
                $process->getErrorOutput(),
            );
            self::assertLessThan(5, microtime(true) - $started);
        } finally {
            $process->stop(1);
            new Filesystem()->deleteDirectory($scratch);
        }
    }

    public function test_file_quota_is_atomic_across_php_processes(): void
    {
        $scratch =
            sys_get_temp_dir() . '/laravel-quota-' . Str::uuid()->toString();
        mkdir($scratch, 0700, true);
        $processes = [];
        try {
            $barrier = $scratch . '/go';
            for ($i = 0; $i < 24; $i++) {
                $process = new Process(
                    [
                        PHP_BINARY,
                        base_path('tests/Fixtures/runtime.php'),
                        'quota',
                        $barrier,
                    ],
                    base_path(),
                    [
                        'LARAVEL_STORAGE_PATH' => $scratch . '/storage',
                        'RATE_LIMIT_AUTH_MAX' => '7',
                        'RATE_LIMIT_AUTH_WINDOW_SECONDS' => '3600',
                        'RATE_LIMIT_STORE' => 'file',
                    ],
                );
                $process->setTimeout(40);
                $process->start();
                $processes[] = $process;
            }
            file_put_contents($barrier, 'go');
            $accepted = 0;
            $limited = 0;
            foreach ($processes as $process) {
                $process->wait();
                self::assertTrue(
                    $process->isSuccessful(),
                    $process->getErrorOutput(),
                );
                $result = trim($process->getOutput());
                if ($result === 'accepted') {
                    $accepted++;
                } elseif ($result === 'limited') {
                    $limited++;
                } else {
                    self::fail('Unexpected quota fixture result');
                }
            }
            self::assertSame(7, $accepted);
            self::assertSame(17, $limited);
        } finally {
            foreach ($processes as $process) {
                $process->stop(1);
            }
            new Filesystem()->deleteDirectory($scratch);
        }
    }

    public function test_coordinated_refresh_and_replay_serialize_on_family_lock(): void
    {
        $tokens = app(AuthService::class)->login(
            new Credentials($this->admin->email, 'FixtureOnly!123'),
        );
        $stored = RefreshToken::query()
            ->where('token_hash', hash('sha256', $tokens->refreshToken))
            ->firstOrFail();
        $scratch =
            sys_get_temp_dir() . '/laravel-refresh-' . Str::uuid()->toString();
        mkdir($scratch, 0700, true);
        $processes = [];
        try {
            $input = $scratch . '/input';
            file_put_contents($input, $tokens->refreshToken);
            chmod($input, 0600);
            $barrier = $scratch . '/go';
            for ($i = 0; $i < 2; $i++) {
                $process = new Process(
                    [
                        PHP_BINARY,
                        base_path('tests/Fixtures/runtime.php'),
                        'refresh',
                        $barrier,
                        $input,
                    ],
                    base_path(),
                );
                $process->setTimeout(30);
                $process->start();
                $processes[] = $process;
            }
            file_put_contents($barrier, 'go');
            $results = [];
            foreach ($processes as $process) {
                $process->wait();
                self::assertTrue(
                    $process->isSuccessful(),
                    $process->getErrorOutput(),
                );
                $results[] = trim($process->getOutput());
            }
            sort($results);
            self::assertSame(['accepted', 'rejected'], $results);
            self::assertNotNull(
                RefreshFamily::query()->findOrFail($stored->family_id)
                    ->revoked_at,
            );
            self::assertSame(
                2,
                RefreshToken::query()
                    ->where('family_id', $stored->family_id)
                    ->count(),
            );
        } finally {
            foreach ($processes as $process) {
                $process->stop(1);
            }
            new Filesystem()->deleteDirectory($scratch);
        }
    }

    public function test_concurrent_notification_inserts_have_unique_recipient_sequence(): void
    {
        $processes = [];
        try {
            for ($i = 0; $i < 4; $i++) {
                $process = new Process(
                    [
                        PHP_BINARY,
                        base_path('tests/Fixtures/runtime.php'),
                        'notifications',
                    ],
                    base_path(),
                );
                $process->setTimeout(60);
                $process->start();
                $processes[] = $process;
            }
            foreach ($processes as $process) {
                $process->wait();
                self::assertTrue(
                    $process->isSuccessful(),
                    $process->getErrorOutput(),
                );
            }
            self::assertSame(
                range(1, 120),
                Notification::query()
                    ->where('recipient_id', $this->admin->id)
                    ->orderBy('sequence')
                    ->pluck('sequence')
                    ->all(),
            );
        } finally {
            foreach ($processes as $process) {
                $process->stop(1);
            }
        }
    }
}
