<?php

declare(strict_types=1);

return ['default' => 'file', 'stores' => ['quota' => ['driver' => 'file', 'path' => storage_path('framework/cache/quota-data'), 'lock_path' => storage_path('framework/cache/quota-locks')], 'file' => ['driver' => 'file', 'path' => storage_path('framework/cache/data'), 'lock_path' => storage_path('framework/cache/locks')], 'redis' => ['driver' => 'redis', 'connection' => 'default', 'lock_connection' => 'default']], 'prefix' => env('REDIS_NAMESPACE', 'modular-laravel').':cache:'];
