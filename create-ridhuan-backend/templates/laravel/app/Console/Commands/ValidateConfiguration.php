<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Config\Settings;
use App\Support\Endpoint\EndpointRegistry;
use Illuminate\Console\Command;

final class ValidateConfiguration extends Command
{
    protected $signature = 'backend:validate-config';

    protected $description = 'Validate runtime configuration and endpoint capabilities without opening SQL';

    public function handle(EndpointRegistry $registry): int
    {
        Settings::validate();
        $registry->all();
        $this->info('Runtime configuration valid');

        return self::SUCCESS;
    }
}
