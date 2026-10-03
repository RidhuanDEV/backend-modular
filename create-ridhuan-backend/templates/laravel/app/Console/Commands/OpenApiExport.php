<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\Observability\OpenApi;
use Illuminate\Console\Command;

final class OpenApiExport extends Command
{
    protected $signature = 'backend:openapi-export {--output=}';

    protected $description = 'Generate OpenAPI from native requests/resources/routes';

    public function handle(OpenApi $api): int
    {
        $option = $this->option('output');
        $path = is_string($option) ? $option : storage_path('app/openapi.json');
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0700, true);
        }
        file_put_contents($path, json_encode($api->generate(), JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n");
        $this->info('OpenAPI artifact generated');

        return self::SUCCESS;
    }
}
