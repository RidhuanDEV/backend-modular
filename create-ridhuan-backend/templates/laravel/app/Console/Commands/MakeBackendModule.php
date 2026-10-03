<?php

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\GeneratorCommand;
use Illuminate\Support\Str;

final class MakeBackendModule extends GeneratorCommand
{
    protected $signature = 'make:backend-module {name}';

    protected $description = 'Generate a typed concern with name field CRUD and a migration draft';

    protected $type = 'Backend module';

    private string $moduleName = '';

    protected function getStub(): string
    {
        return base_path('stubs/backend-model.stub');
    }

    /** @param string $rootNamespace */
    protected function getDefaultNamespace($rootNamespace): string
    {
        return $rootNamespace.'\\Modules\\'.$this->moduleName.'\\Models';
    }

    public function handle(): ?bool
    {
        $input = $this->argument('name');
        if (! preg_match('/^[A-Z][A-Za-z0-9]{0,47}$/D', $input) || in_array(strtolower($input), ['auth', 'users', 'roles', 'permissions', 'uploads', 'notifications', 'system'], true) || $this->isReservedName($input)) {
            $this->fail('Choose an unused PascalCase concern name');
        }
        if (is_dir(app_path('Modules/'.$input))) {
            $this->fail('Existing module is preserved');
        }
        $this->moduleName = $input;
        $slug = Str::snake($input);
        $table = Str::plural($slug);
        $files = [
            'backend-data' => 'Data/'.$input.'Data.php', 'backend-request' => 'Http/Requests/'.$input.'Request.php', 'backend-resource' => 'Http/Resources/'.$input.'Resource.php', 'backend-policy' => 'Policies/'.$input.'Policy.php', 'backend-service' => 'Services/'.$input.'Service.php', 'backend-controller' => 'Http/'.$input.'Controller.php',
        ];
        $outputs = [];
        foreach ($files as $stub => $relative) {
            $outputs[app_path('Modules/'.$input.'/'.$relative)] = $this->render($this->files->get(base_path('stubs/'.$stub.'.stub')), $input, $slug, $table);
        }
        $stamp = date('Y_m_d_His');
        foreach (['postgresql' => 'timestampTz', 'mysql' => 'dateTime'] as $provider => $time) {
            $outputs[database_path('migrations/'.$provider.'/'.$stamp.'_create_'.$table.'.php')] = str_replace('{{ timestamp }}', $time, $this->render($this->files->get(base_path('stubs/backend-migration.stub')), $input, $slug, $table));
        }
        $enumPath = app_path('Support/Endpoint/EndpointId.php');
        $enum = $this->files->get($enumPath);
        $definitions = "<?php\n\ndeclare(strict_types=1);\n\nuse App\\Support\\Endpoint\\{EndpointDefinition, EndpointId};\n\nreturn [\n";
        $cases = '';
        foreach (['list' => ['GET', '', 200], 'get' => ['GET', '/{id}', 200], 'create' => ['POST', '', 201], 'update' => ['PATCH', '/{id}', 200], 'delete' => ['DELETE', '/{id}', 204]] as $action => [$method, $suffix, $status]) {
            $case = $slug.'_'.$action;
            $id = $slug.'.'.$action;
            if (str_contains($enum, "'{$id}'")) {
                $this->fail('Endpoint ID exists');
            }
            $cases .= "    case {$case} = '{$id}';\n";
            $audit = $method === 'GET' ? 'none' : 'required';
            $capability = $method === 'GET' ? 'read' : 'transaction';
            $definitions .= "    new EndpointDefinition(EndpointId::{$case}, '{$method}', '/api/{$table}{$suffix}', '{$slug}', App\\Modules\\{$input}\\Http\\{$input}Controller::class, '{$action}', {$status}, true, 'manage_{$slug}', '{$audit}', '{$capability}', 'internal', 'off'),\n";
        }
        $outputs[app_path('Modules/'.$input.'/endpoints.php')] = $definitions."];\n";
        foreach (array_keys($outputs) as $path) {
            if ($this->files->exists($path)) {
                $this->fail('Existing output is preserved');
            }
        }
        $enum = preg_replace('/}\s*$/', $cases."}\n", $enum) ?? throw new \RuntimeException('Enum update failed');
        if (parent::handle() === false) {
            $this->fail('Native model generation failed');
        }
        foreach ($outputs as $path => $content) {
            $this->files->ensureDirectoryExists(dirname($path));
            $this->files->put($path, $content);
        }
        $this->files->put($enumPath, $enum);
        $this->info('Review migration/permission grant, migrate explicitly, rebuild docs/routes');

        return null;
    }

    private function render(string $text, string $module, string $slug, string $table): string
    {
        return str_replace(['{{ module }}', '{{ slug }}', '{{ table }}'], [$module, $slug, $table], $text);
    }
}
