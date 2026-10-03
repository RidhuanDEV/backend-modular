<?php

declare(strict_types=1);

namespace App\Infrastructure\RateLimit;

use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use App\Support\Observability\Telemetry;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Redis\Connections\PhpRedisConnection;
use Illuminate\Redis\Connections\PredisConnection;
use Illuminate\Redis\RedisManager;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

final class Quota
{
    public function take(string $group, string $identity): void
    {
        $window = Settings::integer(
            'backend.rate.' . $group . '.seconds',
            1,
            3600,
        );
        $maximum = Settings::integer(
            'backend.rate.' . $group . '.max',
            1,
            1000000,
        );
        $key =
            'quota:' .
            hash(
                'sha256',
                Settings::string('backend.namespace') .
                    ':' .
                    $group .
                    ':' .
                    $identity,
            ) .
            ':' .
            intdiv(time(), $window);
        try {
            $hits =
                Settings::string('backend.rate.store') === 'redis'
                    ? $this->redis($key, $window)
                    : $this->file($key, $window);
        } catch (Throwable $error) {
            $reason = match ($error->getMessage()) {
                'Quota directory unavailable' => 'directory',
                'Quota lock unavailable' => 'lock-open',
                'Quota lock timeout' => 'lock-timeout',
                'Invalid quota state' => 'state',
                'Quota write failed' => 'write',
                default => 'storage',
            };
            Log::warning('quota_unavailable', [
                'group' => $group,
                'type' => $error::class,
                'reason' => $reason,
            ]);
            if ($group === 'auth') {
                throw new ApiException(503, 'Authentication quota unavailable');
            }
            try {
                $hits = $this->file($key, $window);
            } catch (Throwable) {
                return;
            }
        }
        if ($hits > $maximum) {
            throw new ApiException(429, 'Rate limit exceeded');
        }
    }

    private function redis(string $key, int $seconds): int
    {
        $started = microtime(true);
        $lua =
            "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n";
        $manager = app(RedisManager::class);
        $connection = $manager->connection();
        $value = match (true) {
            $connection instanceof PredisConnection => $connection->command(
                'eval',
                [$lua, 1, $key, $seconds + 1],
            ),
            $connection instanceof PhpRedisConnection => $connection->eval(
                $lua,
                1,
                $key,
                $seconds + 1,
            ),
            default => throw new \RuntimeException(
                'Unsupported Redis connection',
            ),
        };
        if (!is_int($value)) {
            throw new \RuntimeException('Invalid quota reply');
        }
        app(Telemetry::class)->measure(
            'redis.quota',
            microtime(true) - $started,
        );

        return $value;
    }

    private function file(string $key, int $seconds): int
    {
        $directory = storage_path('framework/cache/quota-locks');
        if (!is_dir($directory)) {
            new Filesystem()->makeDirectory($directory, 0700, true, true);
        }
        if (!is_dir($directory)) {
            throw new \RuntimeException('Quota directory unavailable');
        }
        // Bounded mutex stripes; flock ownership lasts until finally/process termination.
        $handle = fopen(
            $directory . '/' . substr(sha1($key), 0, 2) . '.lock',
            'c',
        );
        if ($handle === false) {
            throw new \RuntimeException('Quota lock unavailable');
        }
        try {
            $deadline = microtime(true) + 2;
            while (!flock($handle, LOCK_EX | LOCK_NB)) {
                if (microtime(true) >= $deadline) {
                    throw new \RuntimeException('Quota lock timeout');
                }
                usleep(10000);
            }
            $cache = Cache::store('quota');
            $prior = $cache->get($key, 0);
            if (!is_int($prior)) {
                throw new \RuntimeException('Invalid quota state');
            }
            $next = $prior + 1;
            if (!$cache->put($key, $next, $seconds + 1)) {
                throw new \RuntimeException('Quota write failed');
            }

            return $next;
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }
}
