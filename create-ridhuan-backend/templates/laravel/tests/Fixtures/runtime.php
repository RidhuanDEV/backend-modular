<?php

declare(strict_types=1);

use App\Infrastructure\RateLimit\Quota;
use App\Modules\Auth\Services\AuthService;
use App\Modules\Notifications\Data\CreateNotification;
use App\Modules\Notifications\Services\NotificationService;
use App\Modules\Users\Models\User;
use App\Support\Http\ApiException;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;

try {
    require dirname(__DIR__, 2).'/vendor/autoload.php';
    $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
    if (! $app instanceof Application) {
        throw new RuntimeException('Invalid application');
    }
    $app->make(Kernel::class)->bootstrap();
    $action = $argv[1] ?? '';
    if ($action === 'platform') {
        if (PHP_INT_SIZE !== 8 || PHP_VERSION_ID < 80500 || PHP_VERSION_ID >= 80600) {
            throw new RuntimeException('PHP8.5 x64 required');
        }
        foreach (['pdo', 'curl', 'dom', 'fileinfo', 'mbstring', 'openssl', 'tokenizer', 'xml', config('database.default') === 'mysql' ? 'pdo_mysql' : 'pdo_pgsql'] as $extension) {
            if (! extension_loaded($extension)) {
                throw new RuntimeException('Missing extension '.$extension);
            }
        }
        echo 'platform verified';
    } elseif ($action === 'quota') {
        $barrier = $argv[2] ?? '';
        $deadline = microtime(true) + 20;
        while (! is_file($barrier)) {
            if (microtime(true) >= $deadline) {
                throw new RuntimeException('Fixture barrier timeout');
            } usleep(10000);
        }
        try {
            app(Quota::class)->take('auth', 'fixture-processes');
            echo 'accepted';
        } catch (ApiException $error) {
            if ($error->status !== 429) {
                throw $error;
            } echo 'limited';
        }
    } elseif ($action === 'refresh' || $action === 'logout') {
        $barrier = $argv[2] ?? '';
        $payload = $argv[3] ?? '';
        $deadline = microtime(true) + 20;
        while (! is_file($barrier)) {
            if (microtime(true) >= $deadline) {
                throw new RuntimeException('Fixture barrier timeout');
            } usleep(10000);
        }
        $raw = file_get_contents($payload);
        if ($raw === false) {
            throw new RuntimeException('Missing fixture input');
        }
        try {
            $service = app(AuthService::class);
            if ($action === 'refresh') {
                $service->refresh($raw);
            } else {
                $service->logout($raw);
            } echo 'accepted';
        } catch (ApiException $error) {
            if ($error->status !== 401) {
                throw $error;
            } echo 'rejected';
        }
    } elseif ($action === 'notifications') {
        $actor = User::query()->where('email', 'admin@example.com')->firstOrFail();
        for ($i = 0; $i < 30; $i++) {
            app(NotificationService::class)->create(new CreateNotification($actor->id, 'Concurrent', 'Body', false), $actor);
        }
        echo 'accepted';
    } else {
        throw new RuntimeException('Unknown fixture operation');
    }

} catch (Throwable $fixtureFailure) {
    fwrite(STDERR, 'Fixture failed: '.$fixtureFailure::class.PHP_EOL);
    exit(1);
}
