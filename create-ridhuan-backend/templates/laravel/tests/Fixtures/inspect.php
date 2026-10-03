<?php

declare(strict_types=1);

use App\Modules\Invoice\Models\Invoice;
use App\Modules\Notifications\Data\CreateNotification;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Services\NotificationService;
use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Uploads\Models\StoredFile;
use App\Modules\Users\Models\User;
use App\Support\Config\Settings;
use Firebase\JWT\JWT;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

try {
    require dirname(__DIR__, 2).'/vendor/autoload.php';
    $app = require dirname(__DIR__, 2).'/bootstrap/app.php';
    if (! $app instanceof Application) {
        throw new RuntimeException('Invalid application');
    }
    $app->make(Kernel::class)->bootstrap();
    $connection = Settings::string('database.default');
    if (! str_starts_with(Settings::string('database.connections.'.$connection.'.database'), 'laravel_test_')) {
        throw new RuntimeException('Owned fixture database required');
    }
    $action = $argv[1] ?? 'stats';
    $actor = User::withTrashed()->where('email', 'admin@example.com')->firstOrFail();
    if ($action === 'stats') {
        $jobs = EmailJob::query()->orderBy('created_at')->get()->map(fn (EmailJob $job): array => ['id' => $job->id, 'notificationId' => $job->notification_id, 'attempts' => $job->attempts, 'status' => $job->status, 'leaseUntil' => $job->lease_until?->toIso8601ZuluString(), 'recipient' => $job->recipient])->all();
        echo json_encode(['jobs' => $jobs, 'sequences' => Notification::query()->where('recipient_id', $actor->id)->orderBy('sequence')->pluck('sequence')->all(), 'audits' => DB::table('activity_logs')->count(), 'files' => StoredFile::query()->count(), 'objects' => count(Storage::disk(Settings::string('backend.upload.disk'))->allFiles())], JSON_THROW_ON_ERROR);
    } elseif ($action === 'fault-audit-on' || $action === 'fault-audit-off') {
        $pg = $connection === 'pgsql';
        $admin = $connection;
        if (! $pg) {
            $configuration = config('database.connections.mysql');
            $password = getenv('MYSQL_ROOT_PASSWORD');
            if (! is_array($configuration) || ! is_string($password) || $password === '') {
                throw new RuntimeException('Owned fixture admin required');
            }
            $configuration['username'] = 'root';
            $configuration['password'] = $password;
            config(['database.connections.fixture-admin' => $configuration]);
            $admin = 'fixture-admin';
        }
        if ($action === 'fault-audit-on') {
            if ($pg) {
                DB::connection($admin)->unprepared("CREATE FUNCTION fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'fixture fault'; END \$\$");
                DB::connection($admin)->unprepared('CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_audit()');
            } else {
                DB::connection($admin)->unprepared("CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture fault'");
            }
        } else {
            DB::connection($admin)->unprepared($pg ? 'DROP TRIGGER fixture_reject_audit ON activity_logs' : 'DROP TRIGGER fixture_reject_audit');
            if ($pg) {
                DB::connection($admin)->unprepared('DROP FUNCTION fixture_reject_audit()');
            }
        }
        echo 'done';
    } elseif ($action === 'grant-invoice') {
        if (! class_exists(Invoice::class) || $actor->role_id === null) {
            throw new RuntimeException('Generated Invoice module required');
        }
        $permission = Permission::query()->firstOrCreate(['name' => 'manage_invoice']);
        Role::query()->findOrFail($actor->role_id)->permissions()->syncWithoutDetaching([$permission->id]);
        echo 'done';
    } elseif ($action === 'backlog') {
        for ($i = 0; $i < 120; $i++) {
            app(NotificationService::class)->create(new CreateNotification($actor->id, 'Backlog '.$i, 'Fixture body', false), $actor);
        }
        echo 'done';
    } elseif ($action === 'short-token') {
        $now = time();
        echo JWT::encode(['sub' => $actor->id, 'iat' => $now, 'exp' => $now + 2, 'iss' => Settings::string('backend.jwt.issuer'), 'aud' => Settings::string('backend.jwt.audience'), 'tokenUse' => 'access'], Settings::string('backend.jwt.secret'), 'HS256');
    } elseif ($action === 'inactive') {
        $actor->delete();
        echo 'done';
    } elseif ($action === 'restore') {
        User::withTrashed()->where('email', 'admin@example.com')->update(['deleted_at' => null]);
        echo 'done';
    } else {
        throw new RuntimeException('Unknown inspection fixture operation');
    }

} catch (Throwable $fixtureFailure) {
    fwrite(STDERR, 'Fixture failed: '.$fixtureFailure::class.PHP_EOL);
    exit(1);
}
