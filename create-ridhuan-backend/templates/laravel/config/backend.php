<?php

declare(strict_types=1);

return [
    'provider' => env('DB_PROVIDER', 'postgresql'),
    'instances' => env('APP_INSTANCE_COUNT', '1'),
    'jwt' => [
        'secret' => env('JWT_SECRET', ''),
        'issuer' => env('JWT_ISSUER', 'modular-laravel'),
        'audience' => env('JWT_AUDIENCE', 'modular-laravel'),
    ],
    'policies' => env('ENDPOINT_POLICIES_JSON', '{}'),
    'cors' => env(
        'CORS_ORIGINS',
        'http://localhost:5173,http://localhost:3000',
    ),
    'proxy' => env('TRUST_PROXY', ''),
    'namespace' => env('REDIS_NAMESPACE', 'modular-laravel'),
    'rate' => [
        'store' => env('RATE_LIMIT_STORE', 'file'),
        'auth' => [
            'max' => env('RATE_LIMIT_AUTH_MAX', '20'),
            'seconds' => env('RATE_LIMIT_AUTH_WINDOW_SECONDS', '60'),
        ],
        'public' => [
            'max' => env('RATE_LIMIT_PUBLIC_MAX', '120'),
            'seconds' => env('RATE_LIMIT_PUBLIC_WINDOW_SECONDS', '60'),
        ],
        'internal' => [
            'max' => env('RATE_LIMIT_INTERNAL_MAX', '240'),
            'seconds' => env('RATE_LIMIT_INTERNAL_WINDOW_SECONDS', '60'),
        ],
    ],
    'cache' => env('CACHE_ENABLED', false),
    'upload' => [
        'disk' => env('UPLOAD_STORAGE', 'local'),
        'max' => env('UPLOAD_MAX_BYTES', '10485760'),
        'mime' => env(
            'UPLOAD_ALLOWED_MIME',
            'image/png,image/jpeg,application/pdf',
        ),
    ],
    'smtp' => env('SMTP_ENABLED', false),
    'smtpSecure' => env('SMTP_SECURE', false),
    'worker' => [
        'concurrency' => env('WORKER_CONCURRENCY', '2'),
        'lease' => env('WORKER_LEASE_SECONDS', '60'),
        'renew' => env('WORKER_RENEW_SECONDS', '20'),
        'timeout' => env('WORKER_CHILD_TIMEOUT_SECONDS', '120'),
        'attempts' => env('WORKER_MAX_ATTEMPTS', '5'),
    ],
    'sse' => [
        'connections' => env('SSE_MAX_CONNECTIONS_PER_INSTANCE', '4'),
        'seconds' => env('SSE_LIFETIME_SECONDS', '840'),
        'poll' => env('SSE_POLL_SECONDS', '3'),
    ],
    'fpm' => ['children' => env('FPM_MAX_CHILDREN', '8')],
    'cleanup' => [
        'batch' => env('CLEANUP_BATCH_SIZE', '500'),
        'days' => env('CLEANUP_RETENTION_DAYS', '30'),
        'audit' => env('CLEANUP_AUDIT_ENABLED', false),
        'auditDays' => env('CLEANUP_AUDIT_DAYS', '365'),
        'uploadHours' => env('UPLOAD_ORPHAN_GRACE_HOURS', '24'),
    ],
    'otel' => [
        'enabled' => env('OTEL_ENABLED', false),
        'endpoint' => env(
            'OTEL_EXPORTER_OTLP_ENDPOINT',
            'http://127.0.0.1:4318',
        ),
        'service' => env('OTEL_SERVICE_NAME', 'modular-laravel'),
    ],
    'seed' => [
        'email' => env('ADMIN_EMAIL', 'admin@example.com'),
        'password' => env('ADMIN_PASSWORD', ''),
    ],
];
