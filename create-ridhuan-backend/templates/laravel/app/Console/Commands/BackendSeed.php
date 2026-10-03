<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Support\Config\Settings;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class BackendSeed extends Command
{
    protected $signature = 'backend:seed';

    protected $description = 'Idempotent explicit seed; existing credentials/grants preserved';

    public function handle(): int
    {
        Settings::validate();
        $password = Settings::string('backend.seed.password');
        if (strlen($password) < 6 || strlen($password) > 72) {
            $this->error('Invalid ADMIN_PASSWORD');

            return self::FAILURE;
        }
        DB::transaction(function () use ($password): void {
            Role::query()->firstOrCreate(['name' => 'user']);
            $admin = Role::query()->firstOrCreate(['name' => 'admin']);
            foreach (
                [
                    'manage_users',
                    'manage_roles',
                    'manage_permissions',
                    'manage_uploads',
                    'manage_notifications',
                ]
                as $name
            ) {
                $permission = Permission::query()->firstOrCreate([
                    'name' => $name,
                ]);
                if ($admin->wasRecentlyCreated) {
                    $admin
                        ->permissions()
                        ->syncWithoutDetaching([$permission->id]);
                }
            }
            $email = mb_strtolower(
                trim(Settings::string('backend.seed.email')),
            );
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new \InvalidArgumentException('Invalid ADMIN_EMAIL');
            }
            if (!User::withTrashed()->where('email', $email)->exists()) {
                User::query()->create([
                    'email' => $email,
                    'password' => Hash::make($password),
                    'role_id' => $admin->id,
                ]);
            }
        });
        $this->info('Seed completed without replacing existing credentials');

        return self::SUCCESS;
    }
}
