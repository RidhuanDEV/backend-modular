<?php

declare(strict_types=1);

return [
    'driver' => 'array',
    'lifetime' => 120,
    'encrypt' => false,
    'files' => storage_path('framework/sessions'),
    'cookie' => 'unused',
    'path' => '/',
    'domain' => null,
    'secure' => true,
    'http_only' => true,
    'same_site' => 'strict',
];
