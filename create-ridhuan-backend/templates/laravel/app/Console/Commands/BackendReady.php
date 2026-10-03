<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Config\Settings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Throwable;

final class BackendReady extends Command
{
    protected $signature = 'backend:ready';

    protected $description = 'Bounded SQL and distributed quota readiness';

    public function handle(): int
    {
        try {
            Settings::validate();
            DB::select('SELECT 1');
            if (Settings::string('backend.rate.store') === 'redis') {
                Redis::connection()->ping();
            }
        } catch (Throwable) {
            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
