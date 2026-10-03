<?php

declare(strict_types=1);

namespace Tests\Integration;

use App\Modules\Auth\Data\Credentials;
use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Auth\Models\RefreshToken;
use App\Modules\Auth\Services\AuthService;
use App\Modules\Auth\Services\JwtService;
use App\Modules\Notifications\Data\CreateNotification;
use App\Modules\Notifications\Models\EmailJob;
use App\Modules\Notifications\Models\Notification;
use App\Modules\Notifications\Services\NotificationService;
use App\Modules\Permissions\Models\Permission;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Support\Http\ApiException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class ContractsTest extends DatabaseCase
{
    public function test_native_validation_normalization_allowlists_and_unknown_logout(): void
    {
        $this->postJson('/api/auth/register', [
            'email' => 'not-email',
            'password' => 'tiny',
        ])->assertStatus(422);
        $this->postJson('/api/auth/register', [
            'email' => ' UPPER@EXAMPLE.COM ',
            'password' => 'ValidPassword!123',
        ])
            ->assertStatus(201)
            ->assertJsonPath('data.email', 'upper@example.com')
            ->assertJsonMissingPath('data.password');
        $this->postJson('/api/auth/register', [
            'email' => 'upper@example.com',
            'password' => 'ValidPassword!123',
        ])->assertStatus(409);
        $before = DB::table('activity_logs')->count();
        $this->postJson('/api/auth/logout', [
            'refreshToken' => 'unknown',
        ])->assertNoContent();
        self::assertSame($before, DB::table('activity_logs')->count());
        $this->postJson('/api/auth/register', [
            'email' => 'long@example.com',
            'password' => str_repeat('é', 37),
        ])->assertStatus(422);
    }

    public function test_rotation_slides_family_and_replay_revocation_commits(): void
    {
        $service = app(AuthService::class);
        $tokens = $service->login(
            new Credentials($this->admin->email, 'FixtureOnly!123'),
        );
        $old = RefreshToken::query()
            ->where('token_hash', hash('sha256', $tokens->refreshToken))
            ->firstOrFail();
        RefreshFamily::query()
            ->whereKey($old->family_id)
            ->update(['expires_at' => now('UTC')->addDay()]);
        $rotated = $service->refresh($tokens->refreshToken);
        self::assertNotSame($tokens->refreshToken, $rotated->refreshToken);
        self::assertNotNull($old->fresh()?->consumed_at);
        self::assertTrue(
            RefreshFamily::query()
                ->findOrFail($old->family_id)
                ->expires_at->greaterThan(now('UTC')->addDays(29)),
        );
        try {
            $service->refresh($tokens->refreshToken);
            self::fail('Replay accepted');
        } catch (ApiException $error) {
            self::assertSame(401, $error->status);
        }
        self::assertNotNull(
            RefreshFamily::query()->findOrFail($old->family_id)->revoked_at,
        );
        try {
            $service->refresh($rotated->refreshToken);
            self::fail('Revoked family accepted');
        } catch (ApiException $error) {
            self::assertSame(401, $error->status);
        }
    }

    public function test_consumed_logout_and_expired_family_are_not_revived(): void
    {
        $service = app(AuthService::class);
        $first = $service->login(
            new Credentials($this->admin->email, 'FixtureOnly!123'),
        );
        $next = $service->refresh($first->refreshToken);
        $service->logout($first->refreshToken);
        $this->postJson('/api/auth/refresh', [
            'refreshToken' => $next->refreshToken,
        ])->assertStatus(401);
        $second = $service->login(
            new Credentials($this->admin->email, 'FixtureOnly!123'),
        );
        $stored = RefreshToken::query()
            ->where('token_hash', hash('sha256', $second->refreshToken))
            ->firstOrFail();
        RefreshFamily::query()
            ->whereKey($stored->family_id)
            ->update(['expires_at' => now('UTC')->subSecond()]);
        $this->postJson('/api/auth/refresh', [
            'refreshToken' => $second->refreshToken,
        ])->assertStatus(401);
        self::assertTrue(
            RefreshFamily::query()
                ->findOrFail($stored->family_id)
                ->expires_at->isPast(),
        );
    }

    public function test_inactive_user_and_privilege_escalation(): void
    {
        $this->postJson('/api/auth/register', [
            'email' => 'member@example.com',
            'password' => 'ValidPassword!123',
        ])->assertCreated();
        $member = User::query()
            ->where('email', 'member@example.com')
            ->firstOrFail();
        $token = app(JwtService::class)->sign($member);
        $this->getJson('/api/users', $this->headers($token))->assertForbidden();
        $role = Role::query()->create(['name' => 'limited']);
        $manage = Permission::query()
            ->where('name', 'manage_roles')
            ->firstOrFail();
        $role->permissions()->sync([$manage->id]);
        $member->role_id = $role->id;
        $member->save();
        $token = app(JwtService::class)->sign($member);
        $other = Permission::query()
            ->where('name', 'manage_users')
            ->firstOrFail();
        $this->postJson(
            '/api/roles/' . $role->id . '/permissions',
            ['permissionIds' => [$other->id]],
            $this->headers($token),
        )->assertForbidden();
        $member->delete();
        $this->getJson(
            '/api/auth/me',
            $this->headers($token),
        )->assertUnauthorized();
    }

    public function test_rbac_crud_pagination_projection_and_seed_repeat(): void
    {
        $roles = $this->getJson('/api/roles', $this->headers())->assertOk();
        $adminRole = $this->admin->role_id;
        $role = $this->postJson(
            '/api/roles',
            ['name' => 'custom'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($role);
        $this->patchJson(
            '/api/roles/' . $role,
            ['name' => 'changed'],
            $this->headers(),
        )
            ->assertOk()
            ->assertJsonPath('data.name', 'changed');
        $this->getJson('/api/roles/' . $role, $this->headers())->assertOk();
        $permission = $this->postJson(
            '/api/permissions',
            ['name' => 'custom_capability'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($permission);
        $this->patchJson(
            '/api/permissions/' . $permission,
            ['name' => 'updated_capability'],
            $this->headers(),
        )->assertOk();
        $this->getJson(
            '/api/permissions/' . $permission,
            $this->headers(),
        )->assertOk();
        $this->getJson('/api/permissions', $this->headers())->assertOk();
        $user = $this->postJson(
            '/api/users',
            [
                'email' => 'new@example.com',
                'password' => 'ValidPassword!123',
                'roleId' => $role,
            ],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($user);
        $this->patchJson(
            '/api/users/' . $user,
            ['email' => 'changed@example.com'],
            $this->headers(),
        )->assertOk();
        $this->getJson('/api/users/' . $user, $this->headers())
            ->assertOk()
            ->assertJsonMissingPath('data.password');
        $this->getJson(
            '/api/users?fields=id,email&limit=1&page=1',
            $this->headers(),
        )
            ->assertOk()
            ->assertJsonPath('meta.limit', 1)
            ->assertJsonPath('meta.totalItems', 2)
            ->assertJsonMissingPath('data.0.role');
        $hash = $this->admin->password;
        Artisan::call('backend:seed');
        self::assertSame($hash, $this->admin->fresh()?->password);
        $this->deleteJson(
            '/api/users/' . $user,
            [],
            $this->headers(),
        )->assertNoContent();
        $this->getJson(
            '/api/users/' . $user,
            $this->headers(),
        )->assertNotFound();
        // Soft-deleted users preserve their FK role assignment.
        $this->deleteJson(
            '/api/roles/' . $role,
            [],
            $this->headers(),
        )->assertStatus(409);
        $this->deleteJson(
            '/api/permissions/' . $permission,
            [],
            $this->headers(),
        )->assertNoContent();
    }

    public function test_notification_order_pages_cursors_read_and_disabled_email(): void
    {
        $service = app(NotificationService::class);
        for ($i = 0; $i < 120; $i++) {
            $service->create(
                new CreateNotification(
                    $this->admin->id,
                    'Item ' . $i,
                    'Fixture body',
                    false,
                ),
                $this->admin,
            );
        }
        $first = $this->getJson('/api/notifications', $this->headers())
            ->assertOk()
            ->assertJsonCount(50, 'data');
        $next = $first->headers->get('X-Next-Cursor');
        self::assertIsString($next);
        $this->getJson('/api/notifications?cursor=' . $next, $this->headers())
            ->assertOk()
            ->assertJsonCount(50, 'data');
        $id = $first->json('data.0.id');
        self::assertIsString($id);
        $this->patchJson(
            '/api/notifications/' . $id . '/read',
            [],
            $this->headers(),
        )->assertOk();
        self::assertCount(50, $service->batch($this->admin, null, true));
        $all = Notification::query()
            ->where('recipient_id', $this->admin->id)
            ->orderBy('sequence')
            ->get();
        self::assertSame(range(1, 120), $all->pluck('sequence')->all());
        $cursor = $service->cursor($this->admin, $all->get(118)?->id);
        self::assertSame(119, $cursor);
        self::assertSame(
            $id,
            $service->batch($this->admin, $cursor, false)?->first()?->id,
        );
        $this->get(
            '/api/notifications/stream',
            $this->headers() + ['Last-Event-ID' => Str::uuid()->toString()],
        )->assertStatus(400);
        $email = $this->postJson(
            '/api/notifications',
            [
                'recipientId' => $this->admin->id,
                'title' => 'Email off',
                'body' => 'Body',
                'sendEmail' => true,
            ],
            $this->headers(),
        )
            ->assertCreated()
            ->assertJsonPath('data.emailStatus', 'FAILED');
        self::assertSame(0, EmailJob::query()->count());
    }

    public function test_local_upload_download_and_allowlist(): void
    {
        Storage::fake('local');
        $pdf = UploadedFile::fake()->createWithContent(
            '../private.pdf',
            "%PDF-1.7\nfixture\n%%EOF",
        );
        $created = $this->post(
            '/api/upload',
            ['file' => $pdf],
            $this->headers(),
        )
            ->assertCreated()
            ->assertJsonMissingPath('data.objectKey');
        $id = $created->json('data.id');
        self::assertIsString($id);
        $this->getJson('/api/upload/' . $id, $this->headers())
            ->assertOk()
            ->assertJsonPath('data.mimeType', 'application/pdf');
        $this->get('/api/upload/' . $id . '?download=true', $this->headers())
            ->assertOk()
            ->assertHeader('Content-Type', 'application/pdf');
        $this->post(
            '/api/upload',
            [
                'file' => UploadedFile::fake()->createWithContent(
                    'fake.png',
                    'not image',
                ),
            ],
            $this->headers(),
        )->assertStatus(422);
    }

    public function test_required_audit_rollback_and_optional_savepoint(): void
    {
        $pg = config('database.default') === 'pgsql';
        if ($pg) {
            $this->faultSql(
                "CREATE FUNCTION fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS \$\$ BEGIN RAISE EXCEPTION 'fixture fault'; END \$\$",
            );
            $this->faultSql(
                'CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_audit()',
            );
        } else {
            $this->faultSql(
                "CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture fault'",
            );
        }
        try {
            $this->postJson('/api/auth/register', [
                'email' => 'rollback@example.com',
                'password' => 'ValidPassword!123',
            ])->assertStatus(500);
            self::assertFalse(
                User::query()->where('email', 'rollback@example.com')->exists(),
            );
            Storage::fake('local');
            $this->post(
                '/api/upload',
                [
                    'file' => UploadedFile::fake()->createWithContent(
                        'compensate.pdf',
                        "%PDF-1.7\nfixture\n%%EOF",
                    ),
                ],
                $this->headers(),
            )->assertStatus(500);
            self::assertSame([], Storage::disk('local')->allFiles());
            $this->postJson('/api/auth/login', [
                'email' => $this->admin->email,
                'password' => 'FixtureOnly!123',
            ])->assertOk();
            self::assertSame(1, RefreshFamily::query()->count());
        } finally {
            $this->faultSql(
                $pg
                    ? 'DROP TRIGGER fixture_reject_audit ON activity_logs'
                    : 'DROP TRIGGER fixture_reject_audit',
            );
            if ($pg) {
                $this->faultSql('DROP FUNCTION fixture_reject_audit()');
            }
        }
    }
}
