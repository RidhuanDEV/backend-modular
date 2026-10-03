<?php

declare(strict_types=1);

namespace App\Support\Config;

use InvalidArgumentException;

final class Settings
{
    public static function string(string $key): string
    {
        $value = config($key);
        if (! is_string($value)) {
            throw new InvalidArgumentException("Invalid setting: {$key}");
        }

        return $value;
    }

    public static function integer(string $key, int $minimum = 0, int $maximum = PHP_INT_MAX): int
    {
        $value = config($key);
        if (! is_int($value) && ! (is_string($value) && preg_match('/^\d+$/D', $value))) {
            throw new InvalidArgumentException("Invalid setting: {$key}");
        }
        $number = filter_var($value, FILTER_VALIDATE_INT);
        if (! is_int($number) || $number < $minimum || $number > $maximum) {
            throw new InvalidArgumentException("Invalid setting: {$key}");
        }

        return $number;
    }

    public static function boolean(string $key): bool
    {
        $value = config($key);
        if (is_bool($value)) {
            return $value;
        }
        if ($value === 'true' || $value === '1' || $value === 1) {
            return true;
        }
        if ($value === 'false' || $value === '0' || $value === 0) {
            return false;
        }
        throw new InvalidArgumentException("Invalid setting: {$key}");
    }

    public static function validate(): void
    {
        if (PHP_INT_SIZE !== 8 || ! in_array(self::string('backend.provider'), ['postgresql', 'mysql'], true)) {
            throw new InvalidArgumentException('Invalid runtime/provider');
        }
        $provider = self::string('backend.provider');
        foreach (['database' => $provider === 'mysql' ? 64 : 63, 'username' => $provider === 'mysql' ? 32 : 63] as $field => $max) {
            $value = self::string('database.connections.'.($provider === 'mysql' ? 'mysql' : 'pgsql').'.'.$field);
            if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/D', $value) || strlen($value) > $max) {
                throw new InvalidArgumentException("Invalid database {$field}");
            }
        }
        $secret = self::string('backend.jwt.secret');
        if (strlen($secret) < 32 || $secret === self::string('app.key')) {
            throw new InvalidArgumentException('Invalid JWT_SECRET');
        }
        $key = self::string('app.key');
        if (! str_starts_with($key, 'base64:') || strlen(base64_decode(substr($key, 7), true) ?: '') !== 32) {
            throw new InvalidArgumentException('Invalid APP_KEY');
        }
        $store = self::string('backend.rate.store');
        if (! in_array($store, ['file', 'redis'], true) || (self::integer('backend.instances', 1) > 1 && $store !== 'redis')) {
            throw new InvalidArgumentException('Invalid RATE_LIMIT_STORE');
        }
        if (self::integer('backend.sse.connections', 1) >= self::integer('backend.fpm.children', 2)) {
            throw new InvalidArgumentException('SSE budget must reserve HTTP workers');
        }
        if (self::string('app.env') === 'production' && self::string('backend.cors') === '') {
            throw new InvalidArgumentException('CORS_ORIGINS is mandatory');
        }
        foreach (['backend.cache', 'backend.smtp', 'backend.cleanup.audit', 'backend.otel.enabled', 'backend.smtpSecure'] as $flag) {
            self::boolean($flag);
        }
        foreach (['auth', 'public', 'internal'] as $group) {
            self::integer('backend.rate.'.$group.'.max', 1, 1000000);
            self::integer('backend.rate.'.$group.'.seconds', 1, 3600);
        }
        self::integer('backend.worker.concurrency', 1, 16);
        self::integer('backend.worker.attempts', 1, 5);
        self::integer('backend.worker.timeout', 1, 600);
        if (self::integer('backend.worker.renew', 1, 120) * 2 >= self::integer('backend.worker.lease', 10, 600)) {
            throw new InvalidArgumentException('Invalid worker lease renewal budget');
        }
        self::integer('backend.sse.seconds', 1, 840);
        self::integer('backend.sse.poll', 1, 15);
        self::integer('backend.cleanup.batch', 1, 10000);
        foreach (['backend.jwt.issuer', 'backend.jwt.audience', 'backend.namespace'] as $key) {
            if (self::string($key) === '' || strlen(self::string($key)) > 128) {
                throw new InvalidArgumentException("Invalid setting: {$key}");
            }
        }
        foreach (array_filter(explode(',', self::string('backend.cors'))) as $origin) {
            $parsed = parse_url($origin);
            if (! is_array($parsed) || ! in_array($parsed['scheme'] ?? '', ['http', 'https'], true) || ! isset($parsed['host']) || isset($parsed['user']) || isset($parsed['query']) || isset($parsed['fragment']) || isset($parsed['path'])) {
                throw new InvalidArgumentException('Invalid CORS_ORIGINS');
            }
        }
        if (! in_array(self::string('backend.upload.disk'), ['local', 's3'], true)) {
            throw new InvalidArgumentException('Invalid UPLOAD_STORAGE');
        }
        if (self::string('backend.upload.disk') === 's3') {
            foreach (['key', 'secret', 'region', 'bucket'] as $field) {
                if (self::string('filesystems.disks.s3.'.$field) === '') {
                    throw new InvalidArgumentException('S3 configuration required');
                }
            }
            $prefix = self::string('filesystems.disks.s3.root');
            if (strlen($prefix) > 128 || ! preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]*$/D', $prefix)) {
                throw new InvalidArgumentException('Dedicated S3_PREFIX required');
            }
        }
        foreach (explode(',', self::string('backend.upload.mime')) as $mime) {
            if (! in_array($mime, ['image/png', 'image/jpeg', 'application/pdf'], true)) {
                throw new InvalidArgumentException('Invalid UPLOAD_ALLOWED_MIME');
            }
        }
        if (self::string('app.env') === 'production') {
            $password = self::string('database.connections.'.($provider === 'mysql' ? 'mysql' : 'pgsql').'.password');
            if (strlen($password) < 12 || in_array(strtolower($password), ['changeme', 'password', 'backend'], true) || preg_match('/placeholder|change-me/i', $secret)) {
                throw new InvalidArgumentException('Production credentials required');
            }
        }
        if (is_file(base_path('backend-template.json'))) {
            $identity = json_decode(file_get_contents(base_path('backend-template.json')) ?: '', true, flags: JSON_THROW_ON_ERROR);
            if (! is_array($identity) || ($identity['databaseProvider'] ?? null) !== $provider) {
                throw new InvalidArgumentException('Database provider differs from generated project');
            }
        }
    }
}
