<?php

declare(strict_types=1);

return ['default' => env('UPLOAD_STORAGE', 'local'), 'disks' => ['local' => ['driver' => 'local', 'root' => storage_path('app/private/uploads'), 'throw' => true, 'serve' => false], 's3' => ['driver' => 's3', 'key' => env('S3_ACCESS_KEY_ID'), 'secret' => env('S3_SECRET_ACCESS_KEY'), 'region' => env('S3_REGION', 'us-east-1'), 'bucket' => env('S3_BUCKET', 'uploads'), 'endpoint' => env('S3_ENDPOINT'), 'root' => env('S3_PREFIX', 'modular-laravel'), 'http' => ['connect_timeout' => 2, 'timeout' => 10], 'retries' => 1, 'use_path_style_endpoint' => true, 'throw' => true]], 'links' => []];
