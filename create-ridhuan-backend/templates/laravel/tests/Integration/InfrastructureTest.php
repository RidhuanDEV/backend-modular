<?php

declare(strict_types=1);

namespace Tests\Integration;

use App\Infrastructure\Outbox\Outbox;
use App\Modules\Auth\Data\Credentials;
use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Auth\Models\RefreshToken;
use App\Modules\Auth\Services\AuthService;
use App\Modules\Notifications\Data\CreateNotification;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Services\NotificationService;
use App\Modules\Uploads\Models\StoredFile;
use App\Support\Config\Settings;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class InfrastructureTest extends DatabaseCase
{
    public function test_cleanup_upload_grace_reference_and_opt_in_audit_retention(): void
    {
        Storage::fake('local');
        config(['backend.upload.disk' => 'local', 'backend.cleanup.audit' => false]);
        $disk = Storage::disk('local');
        $old = Str::uuid()->toString().'.pdf';
        $fresh = Str::uuid()->toString().'.pdf';
        $reference = Str::uuid()->toString().'.pdf';
        $unowned = str_repeat('a', 36).'.pdf';
        foreach ([$old, $fresh, $reference, 'unowned.pdf', $unowned] as $key) {
            $disk->put($key, '%PDF-1.7 fixture');
        }
        foreach ([$old, $reference, 'unowned.pdf', $unowned] as $key) {
            touch($disk->path($key), time() - 172800);
        }
        StoredFile::query()->create(['storage' => 'local', 'object_key' => $reference, 'original_name' => 'fixture.pdf', 'mime_type' => 'application/pdf', 'size' => 16, 'uploader_id' => $this->admin->id]);
        DB::table('activity_logs')->insert(['id' => Str::uuid()->toString(), 'behavior' => 'FIXTURE', 'module' => 'fixture', 'created_at' => now('UTC')->subDays(400), 'updated_at' => now('UTC')->subDays(400)]);
        $audits = DB::table('activity_logs')->count();
        self::assertGreaterThan(0, $audits);
        Artisan::call('backend:cleanup', ['--dry-run' => true]);
        self::assertTrue($disk->exists($old));
        Artisan::call('backend:cleanup', ['--apply' => true]);
        self::assertFalse($disk->exists($old));
        foreach ([$fresh, $reference, 'unowned.pdf', $unowned] as $key) {
            self::assertTrue($disk->exists($key));
        }
        self::assertSame($audits, DB::table('activity_logs')->count());
        config(['backend.cleanup.audit' => true, 'backend.cleanup.auditDays' => 365]);
        Artisan::call('backend:cleanup', ['--apply' => true]);
        self::assertSame(0, DB::table('activity_logs')->count());
    }

    public function test_outbox_snapshot_fencing_renewal_and_exhausted_attempt(): void
    {
        config(['backend.smtp' => true]);
        $notification = app(NotificationService::class)->create(new CreateNotification($this->admin->id, 'Snapshot', 'Immutable body', true), $this->admin);
        $job = EmailJob::query()->where('notification_id', $notification->id)->firstOrFail();
        $email = $job->recipient;
        $this->admin->email = 'changed@example.com';
        $this->admin->save();
        self::assertSame($email, $job->fresh()?->recipient);
        $outbox = app(Outbox::class);
        $first = $outbox->claim();
        self::assertNotNull($first);
        self::assertTrue($outbox->renew($first));
        self::assertNull($outbox->claim());
        EmailJob::query()->whereKey($job->id)->update(['lease_until' => now('UTC')->subSecond()]);
        $next = $outbox->claim();
        self::assertNotNull($next);
        self::assertNotSame($first->leaseId, $next->leaseId);
        self::assertFalse($outbox->complete($first, true));
        self::assertTrue($outbox->complete($next, true));
        self::assertSame('SENT', $notification->fresh()?->email_status->value);
        $last = app(NotificationService::class)->create(new CreateNotification($this->admin->id, 'Exhausted', 'Body', true), $this->admin);
        EmailJob::query()->where('notification_id', $last->id)->update(['attempts' => 5, 'lease_until' => now('UTC')->subSecond(), 'lease_id' => Str::uuid()->toString()]);
        self::assertNull($outbox->claim());
        self::assertSame('FAILED', $last->fresh()?->email_status->value);
        self::assertSame(5, EmailJob::query()->where('notification_id', $last->id)->firstOrFail()->attempts);
    }

    public function test_cleanup_dry_run_retains_active_traces_pending_jobs_notifications_and_references(): void
    {
        Storage::fake('local');
        $tokens = app(AuthService::class)->login(new Credentials($this->admin->email, 'FixtureOnly!123'));
        app(AuthService::class)->refresh($tokens->refreshToken);
        $active = RefreshToken::query()->where('token_hash', hash('sha256', $tokens->refreshToken))->firstOrFail();
        $active->created_at = now('UTC')->subDays(60);
        $active->save();
        $old = RefreshFamily::query()->create(['user_id' => $this->admin->id, 'expires_at' => now('UTC')->subDays(60), 'revoked_at' => now('UTC')->subDays(60)]);
        config(['backend.smtp' => true]);
        $notice = app(NotificationService::class)->create(new CreateNotification($this->admin->id, 'Keep', 'Pending body', true), $this->admin);
        $audit = DB::table('activity_logs')->count();
        Artisan::call('backend:cleanup', ['--dry-run' => true]);
        self::assertTrue(RefreshFamily::query()->whereKey($old->id)->exists());
        Artisan::call('backend:cleanup', ['--apply' => true]);
        self::assertFalse(RefreshFamily::query()->whereKey($old->id)->exists());
        self::assertTrue(RefreshToken::query()->whereKey($active->id)->exists());
        self::assertTrue(Notification::query()->whereKey($notice->id)->exists());
        self::assertSame(1, EmailJob::query()->count());
        self::assertSame($audit, DB::table('activity_logs')->count());
    }

    public function test_native_pre_hardening_upgrade_preserves_expiry_and_backfills_sequence(): void
    {
        $history = DB::table('migrations')->orderBy('migration')->pluck('migration')->all();
        $hardening = database_path('migrations/'.Settings::string('backend.provider').'/2026_10_03_000002_add_hardening.php');
        self::assertSame(0, Artisan::call('migrate:rollback', ['--path' => [$hardening], '--realpath' => true, '--step' => count($history), '--force' => true]));
        self::assertFalse(Schema::hasTable('refresh_families'));
        $family = Str::uuid()->toString();
        $expiry = now('UTC')->addDays(7);
        $time = now('UTC')->subDay();
        DB::table('refresh_tokens')->insert(['id' => Str::uuid()->toString(), 'family_id' => $family, 'user_id' => $this->admin->id, 'token_hash' => hash('sha256', 'legacy-fixture'), 'expires_at' => $expiry, 'consumed_at' => null, 'created_at' => $time, 'updated_at' => $time]);
        $ids = [Str::uuid()->toString(), Str::uuid()->toString()];
        sort($ids);
        foreach (array_reverse($ids) as $id) {
            DB::table('notifications')->insert(['id' => $id, 'recipient_id' => $this->admin->id, 'actor_id' => $this->admin->id, 'title' => 'Legacy', 'body' => 'Fixture', 'email_status' => 'PENDING', 'created_at' => $time, 'updated_at' => $time]);
        }
        Artisan::call('migrate', ['--force' => true]);
        $restored = RefreshFamily::query()->findOrFail($family);
        self::assertSame($expiry->getTimestamp(), $restored->expires_at->getTimestamp());
        self::assertNull($restored->revoked_at);
        self::assertSame($ids, Notification::query()->orderBy('sequence')->pluck('id')->all());
        self::assertSame(['FAILED', 'FAILED'], Notification::query()->orderBy('sequence')->get()->map(fn (Notification $n): string => $n->email_status->value)->all());
        self::assertSame(0, EmailJob::query()->count());
        self::assertSame($history, DB::table('migrations')->orderBy('migration')->pluck('migration')->all());
    }
}
