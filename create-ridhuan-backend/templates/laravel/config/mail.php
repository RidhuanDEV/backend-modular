<?php

declare(strict_types=1);

return [
    'default' => 'smtp',
    'mailers' => [
        'smtp' => [
            'transport' => 'smtp',
            'scheme' => filter_var(
                env('SMTP_SECURE', false),
                FILTER_VALIDATE_BOOL,
            )
                ? 'smtps'
                : 'smtp',
            'host' => env('SMTP_HOST', '127.0.0.1'),
            'port' => env('SMTP_PORT', '1025'),
            'username' => env('SMTP_USER'),
            'password' => env('SMTP_PASSWORD'),
            'timeout' => 25,
        ],
    ],
    'from' => [
        'address' => env('SMTP_FROM', 'noreply@example.com'),
        'name' => env('APP_NAME', 'Modular Backend'),
    ],
];
