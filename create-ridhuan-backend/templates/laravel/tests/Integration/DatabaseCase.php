<?php

declare(strict_types=1);

namespace Tests\Integration;

use App\Modules\Auth\Services\JwtService;
use App\Modules\Users\Models\User;
use App\Support\Config\Settings;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

abstract class DatabaseCase extends TestCase
{
    protected User $admin;

    protected string $bearer;

    protected function setUp(): void
    {
        parent::setUp();
        $connection = Settings::string('database.default');
        if (! str_starts_with(Settings::string('database.connections.'.$connection.'.database'), 'laravel_test_')) {
            throw new \RuntimeException('Integration fixtures require owned laravel_test_ database');
        }
        config(['app.key' => 'base64:'.base64_encode(str_repeat('k', 32)), 'backend.jwt.secret' => str_repeat('j', 96), 'backend.seed.password' => 'FixtureOnly!123', 'backend.rate.auth.max' => 10000, 'backend.rate.public.max' => 10000, 'backend.rate.internal.max' => 10000, 'backend.policies' => '{}']);
        Artisan::call('migrate:fresh', ['--force' => true]);
        Artisan::call('backend:seed');
        $this->admin = User::query()->where('email', 'admin@example.com')->firstOrFail();
        $this->bearer = app(JwtService::class)->sign($this->admin);
    }

    /** @return array<string, string> */
    protected function headers(?string $bearer = null): array
    {
        return ['Authorization' => 'Bearer '.($bearer ?? $this->bearer), 'Accept' => 'application/json'];
    }

    protected function faultSql(string $sql): void
    {
        if (Settings::string('database.default') !== 'mysql') {
            DB::unprepared($sql);

            return;
        }
        $connection = config('database.connections.mysql');
        $password = getenv('RIDHUAN_FIXTURE_ADMIN_PASSWORD');
        if (! is_array($connection) || ! is_string($password) || $password === '' || ! str_starts_with(Settings::string('database.connections.mysql.database'), 'laravel_test_')) {
            throw new \RuntimeException('Owned fixture administrator required for fault injection');
        }
        $connection['username'] = 'root';
        $connection['password'] = $password;
        config(['database.connections.fixture-admin' => $connection]);
        DB::connection('fixture-admin')->unprepared($sql);
    }
}
