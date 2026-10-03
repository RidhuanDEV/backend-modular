<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Endpoint\EndpointRegistry;
use Illuminate\Console\Command;

final class VerifyContract extends Command
{
    protected $signature = 'backend:verify-contract';

    protected $description = 'Compare native route table to the typed registry';

    public function handle(EndpointRegistry $registry): int
    {
        $registry->verify();
        $this->info('All HTTP routes match registry');

        return self::SUCCESS;
    }
}
