<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;

try {
    require dirname(__DIR__, 2) . '/vendor/autoload.php';
    $app = require dirname(__DIR__, 2) . '/bootstrap/app.php';
    if (!($app instanceof Application)) {
        throw new RuntimeException('Invalid application');
    }
    $app->make(Kernel::class)->bootstrap();
    $kernel = $app->make(Kernel::class);
    try {
        foreach (
            [
                'config:cache',
                'backend:validate-config',
                'route:cache',
                'backend:verify-contract',
                'backend:openapi-export',
            ]
            as $command
        ) {
            $code = $kernel->call($command);
            echo $kernel->output();
            if ($code !== 0) {
                throw new RuntimeException(
                    'Native cache command failed ' . $command,
                );
            }
        }
    } finally {
        $kernel->call('config:clear');
        $kernel->call('route:clear');
    }
} catch (Throwable $fixtureFailure) {
    fwrite(STDERR, 'Fixture failed: ' . $fixtureFailure::class . PHP_EOL);
    exit(1);
}
