<?php

declare(strict_types=1);
use Pdo\Mysql;

return [
    'default' => env('DB_PROVIDER', 'postgresql') === 'mysql' ? 'mysql' : 'pgsql',
    'connections' => [
        'pgsql' => ['driver' => 'pgsql', 'host' => env('DB_HOST', '127.0.0.1'), 'port' => env('DB_PORT', '5432'), 'database' => env('DB_DATABASE', 'backend'), 'username' => env('DB_USERNAME', 'backend'), 'password' => env('DB_PASSWORD', ''), 'charset' => 'utf8', 'prefix' => '', 'prefix_indexes' => true, 'search_path' => 'public', 'sslmode' => env('DB_SSLMODE', 'prefer'), 'timezone' => 'UTC', 'options' => [PDO::ATTR_TIMEOUT => 5]],
        'mysql' => ['driver' => 'mysql', 'host' => env('DB_HOST', '127.0.0.1'), 'port' => env('DB_PORT', '3306'), 'database' => env('DB_DATABASE', 'backend'), 'username' => env('DB_USERNAME', 'backend'), 'password' => env('DB_PASSWORD', ''), 'charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'prefix' => '', 'prefix_indexes' => true, 'strict' => true, 'engine' => 'InnoDB', 'timezone' => '+00:00', 'options' => extension_loaded('pdo_mysql') ? array_filter([PDO::ATTR_TIMEOUT => 5, Mysql::ATTR_SSL_CA => env('MYSQL_SSL_CA')]) : []],
    ],
    'migrations' => ['table' => 'migrations', 'update_date_on_publish' => true],
    'redis' => ['client' => 'predis', 'options' => ['prefix' => env('REDIS_NAMESPACE', 'modular-laravel').':'], 'default' => ['host' => env('REDIS_HOST', '127.0.0.1'), 'password' => env('REDIS_PASSWORD'), 'port' => env('REDIS_PORT', '6379'), 'database' => 0, 'timeout' => 2, 'read_write_timeout' => 2]],
];
