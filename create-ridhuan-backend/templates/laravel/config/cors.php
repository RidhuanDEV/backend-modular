<?php

declare(strict_types=1);

return [
    'paths' => ['*'],
    'allowed_methods' => ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => array_values(
        array_filter(
            explode(
                ',',
                env(
                    'CORS_ORIGINS',
                    'http://localhost:5173,http://localhost:3000',
                ),
            ),
        ),
    ),
    'allowed_origins_patterns' => [],
    'allowed_headers' => [
        'Authorization',
        'Content-Type',
        'Last-Event-ID',
        'X-Request-ID',
        'X-Requested-With',
    ],
    'exposed_headers' => ['X-Request-ID', 'X-Next-Cursor', 'Retry-After'],
    'max_age' => 600,
    // Cookie mode sends the refresh cookie cross-origin, which needs credentialed CORS
    // with the exact origin allowlist above (never a wildcard).
    'supports_credentials' =>
        env('REFRESH_TOKEN_TRANSPORT', 'body') === 'cookie',
];
