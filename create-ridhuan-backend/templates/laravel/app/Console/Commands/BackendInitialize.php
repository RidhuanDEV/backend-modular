<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;

final class BackendInitialize extends Command
{
    protected $signature = 'backend:initialize {--provider=postgresql} {--port=8000} {--name=Modular Laravel}';

    protected $description = 'Create an env once; preserves existing env/data';

    public function handle(): int
    {
        if (is_file(base_path('.env'))) {
            $this->error('Existing .env is preserved');

            return self::FAILURE;
        }
        $provider = $this->option('provider');
        $port = $this->option('port');
        $name = $this->option('name');
        if (! in_array($provider, ['postgresql', 'mysql'], true) || ! is_string($port) || ! ctype_digit($port) || (int) $port < 1 || (int) $port > 65535 || ! is_string($name) || preg_match('/[\r\n\x00]/', $name)) {
            $this->error('Invalid initializer options');

            return self::FAILURE;
        }
        $template = file_get_contents(base_path($provider === 'mysql' ? '.env.mysql.example' : '.env.example'));
        if ($template === false) {
            return self::FAILURE;
        }
        $appKey = 'base64:'.base64_encode(random_bytes(32));
        $jwt = bin2hex(random_bytes(48));
        $databasePassword = bin2hex(random_bytes(24));
        $replacements = ['APP_NAME' => self::quote($name), 'APP_KEY' => $appKey, 'JWT_SECRET' => $jwt, 'APP_URL' => 'http://localhost:'.$port, 'APP_PORT' => $port, 'PORT' => $port, 'DB_PASSWORD' => $databasePassword, 'POSTGRES_PASSWORD' => $databasePassword, 'MYSQL_PASSWORD' => $databasePassword, 'ADMIN_PASSWORD' => bin2hex(random_bytes(24)), 'MYSQL_ROOT_PASSWORD' => bin2hex(random_bytes(24))];
        foreach ($replacements as $key => $value) {
            $template = preg_replace('/^'.$key.'=.*$/m', $key.'='.$value, $template) ?? throw new \RuntimeException('Env rendering failed');
        }
        $handle = fopen(base_path('.env'), 'x');
        if ($handle === false) {
            return self::FAILURE;
        }
        try {
            fwrite($handle, $template);
        } finally {
            fclose($handle);
        }
        chmod(base_path('.env'), 0600);
        $this->info('Environment created; install/migrate/seed stay explicit');

        return self::SUCCESS;
    }

    private static function quote(string $value): string
    {
        return '"'.str_replace(['\\', '"', '$'], ['\\\\', '\\"', '\\$'], $value).'"';
    }
}
