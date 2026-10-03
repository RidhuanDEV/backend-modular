<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Config\Settings;
use Illuminate\Console\Command;

final class BackendMigrate extends Command
{
    protected $signature = 'backend:migrate {--force}';

    protected $description = 'Run selected provider native migrations';

    public function handle(): int
    {
        Settings::validate();

        return $this->call('migrate', ['--force' => $this->option('force') === true]);
    }
}
