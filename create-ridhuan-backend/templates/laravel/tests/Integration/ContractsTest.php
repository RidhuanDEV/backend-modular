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

    public function test_rotation_keeps_absolute_lifetime_and_replay_revocation_commits(): void
    {
        $service = app(AuthService::class);
        $tokens = $service->login(
            new Credentials($this->admin->email, 'FixtureOnly!123'),
        );
        $old = RefreshToken::query()
            ->where('token_hash', hash('sha256', $tokens->refreshToken))
            ->firstOrFail();
        $family = RefreshFamily::query()->findOrFail($old->family_id);
        // Login: absolute family lifetime (90d default), idle token window (30d default).
        self::assertTrue(
            $family->expires_at->between(
                now('UTC')->addDays(90)->subMinute(),
                now('UTC')->addDays(90)->addMinute(),
            ),
        );
        self::assertTrue(
            $old->expires_at->between(
                now('UTC')->addDays(30)->subMinute(),
                now('UTC')->addDays(30)->addMinute(),
            ),
        );
        $cap = now('UTC')->addDay()->startOfSecond();
        RefreshFamily::query()
            ->whereKey($old->family_id)
            ->update(['expires_at' => $cap]);
        $rotated = $service->refresh($tokens->refreshToken);
        self::assertNotSame($tokens->refreshToken, $rotated->refreshToken);
        self::assertNotNull($old->fresh()?->consumed_at);
        // Rotation neither extends the family nor issues a token past it.
        self::assertTrue(
            RefreshFamily::query()
                ->findOrFail($old->family_id)
                ->expires_at->equalTo($cap),
        );
        self::assertTrue(
            RefreshToken::query()
                ->where('token_hash', hash('sha256', $rotated->refreshToken))
                ->firstOrFail()
                ->expires_at->equalTo($cap),
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

    public function test_admin_grants_permission_created_after_seed(): void
    {
        $permission = $this->postJson(
            '/api/permissions',
            ['name' => 'manage_invoices'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($permission);
        $role = Role::query()->create(['name' => 'billing']);
        $this->postJson(
            '/api/roles/' . $role->id . '/permissions',
            ['permissionIds' => [$permission]],
            $this->headers(),
        )->assertSuccessful();
        self::assertTrue($role->permissions()->whereKey($permission)->exists());
    }

    public function test_unknown_email_login_is_rejected_like_a_wrong_password(): void
    {
        $this->postJson('/api/auth/login', [
            'email' => 'nobody@example.com',
            'password' => 'FixtureOnly!123',
        ])->assertUnauthorized();
        $this->postJson('/api/auth/login', [
            'email' => $this->admin->email,
            'password' => 'WrongPassword!123',
        ])->assertUnauthorized();
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

    public function test_root_admin_grants_permissions_created_after_seed(): void
    {
        $permission = $this->postJson(
            '/api/permissions',
            ['name' => 'manage_invoices'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        $role = $this->postJson(
            '/api/roles',
            ['name' => 'billing'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($permission);
        self::assertIsString($role);
        $this->postJson(
            '/api/roles/' . $role . '/permissions',
            ['permissionIds' => [$permission]],
            $this->headers(),
        )->assertOk();
        $this->patchJson(
            '/api/roles/' . $role,
            ['name' => 'billing-team'],
            $this->headers(),
        )->assertOk();
    }

    public function test_unknown_email_login_is_rejected(): void
    {
        $this->postJson('/api/auth/login', [
            'email' => 'nobody@example.com',
            'password' => 'Whatever!123',
        ])->assertUnauthorized();
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

    public function test_system_primitives_last_root_sessions_and_file_ownership(): void
    {
        $system = Permission::query()
            ->where('name', 'manage_users')
            ->firstOrFail();
        $this->patchJson(
            '/api/permissions/' . $system->id,
            ['name' => 'renamed'],
            $this->headers(),
        )->assertForbidden();
        $this->deleteJson(
            '/api/permissions/' . $system->id,
            [],
            $this->headers(),
        )->assertForbidden();
        $custom = $this->postJson(
            '/api/permissions',
            ['name' => 'custom_access'],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($custom);
        // RBAC only: a new permission is granted to every role managing permissions.
        self::assertTrue(
            DB::table('role_permissions')
                ->where('role_id', $this->admin->role_id)
                ->where('permission_id', $custom)
                ->exists(),
        );
        $this->patchJson(
            '/api/permissions/' . $custom,
            ['name' => 'manage_users'],
            $this->headers(),
        )->assertForbidden();
        $this->patchJson(
            '/api/permissions/' . $custom,
            ['name' => 'custom_renamed'],
            $this->headers(),
        )->assertOk();
        $userRole = Role::query()->where('name', 'user')->firstOrFail();
        $this->patchJson(
            '/api/roles/' . $userRole->id,
            ['name' => 'renamed'],
            $this->headers(),
        )->assertForbidden();
        $this->deleteJson(
            '/api/roles/' . $userRole->id,
            [],
            $this->headers(),
        )->assertForbidden();
        $this->postJson(
            '/api/roles',
            ['name' => 'admin'],
            $this->headers(),
        )->assertForbidden();
        // The root role must keep every system permission.
        $this->postJson(
            '/api/roles/' . $this->admin->role_id . '/permissions',
            ['permissionIds' => [$custom]],
            $this->headers(),
        )->assertForbidden();
        // A role change revokes every refresh session of that user.
        $this->postJson('/api/auth/register', [
            'email' => 'uploader@example.com',
            'password' => 'ValidPassword!123',
        ])->assertCreated();
        $member = User::query()
            ->where('email', 'uploader@example.com')
            ->firstOrFail();
        $tokens = app(AuthService::class)->login(
            new Credentials('uploader@example.com', 'ValidPassword!123'),
        );
        $uploader = Role::query()->create(['name' => 'uploader']);
        $uploader
            ->permissions()
            ->sync([
                Permission::query()
                    ->where('name', 'manage_uploads')
                    ->firstOrFail()->id,
            ]);
        $this->patchJson(
            '/api/users/' . $member->id,
            ['roleId' => $uploader->id],
            $this->headers(),
        )->assertOk();
        $this->postJson('/api/auth/refresh', [
            'refreshToken' => $tokens->refreshToken,
        ])->assertUnauthorized();
        // Files are readable and downloadable by their uploader and root users only.
        Storage::fake('local');
        $id = $this->post(
            '/api/upload',
            [
                'file' => UploadedFile::fake()->createWithContent(
                    'private.pdf',
                    "%PDF-1.7\nfixture\n%%EOF",
                ),
            ],
            $this->headers(),
        )
            ->assertCreated()
            ->json('data.id');
        self::assertIsString($id);
        $token = app(JwtService::class)->sign($member->refresh());
        $this->getJson(
            '/api/upload/' . $id,
            $this->headers($token),
        )->assertNotFound();
        $this->get(
            '/api/upload/' . $id . '?download=true',
            $this->headers($token),
        )->assertNotFound();
        $this->getJson('/api/upload/' . $id, $this->headers())->assertOk();
        // The only holder of the system permissions cannot be demoted.
        $this->patchJson(
            '/api/users/' . $this->admin->id,
            ['roleId' => $userRole->id],
            $this->headers(),
        )->assertForbidden();
        // Search wildcards match literally.
        $this->getJson('/api/users?search=%25', $this->headers())
            ->assertOk()
            ->assertJsonCount(0, 'data');
        $this->getJson(
            '/api/users?fields=password',
            $this->headers(),
        )->assertStatus(422);
    }

    public function test_refresh_cookie_transport_keeps_token_out_of_json(): void
    {
        config([
            'backend.refresh.transport' => 'cookie',
            'backend.refresh.secure' => false,
        ]);
        // JSON test requests only carry cookies with credentials, like a browser fetch.
        $this->withCredentials();
        $login = $this->postJson('/api/auth/login', [
            'email' => $this->admin->email,
            'password' => 'FixtureOnly!123',
        ])
            ->assertOk()
            ->assertJsonMissingPath('data.refreshToken');
        $cookie = $login->getCookie('refresh_token', false);
        self::assertNotNull($cookie);
        self::assertTrue($cookie->isHttpOnly());
        self::assertSame('/api/auth', $cookie->getPath());
        self::assertSame('lax', $cookie->getSameSite());
        $first = (string) $cookie->getValue();
        // Test cookies persist across requests, so check the missing-token case first.
        $this->postJson(
            '/api/auth/refresh',
            [],
            [
                'X-Requested-With' => 'fetch',
            ],
        )->assertStatus(400);
        // Browsers attach cookies automatically, so a bare cross-site POST must fail.
        $this->withUnencryptedCookie('refresh_token', $first)
            ->postJson('/api/auth/refresh', [])
            ->assertForbidden();
        $refreshed = $this->withUnencryptedCookie('refresh_token', $first)
            ->postJson('/api/auth/refresh', [], ['X-Requested-With' => 'fetch'])
            ->assertOk()
            ->assertJsonMissingPath('data.refreshToken');
        $rotated = (string) $refreshed
            ->getCookie('refresh_token', false)
            ?->getValue();
        self::assertNotSame('', $rotated);
        self::assertNotSame($first, $rotated);
        $logout = $this->withUnencryptedCookie('refresh_token', $rotated)
            ->postJson('/api/auth/logout', [], ['X-Requested-With' => 'fetch'])
            ->assertNoContent();
        self::assertTrue(
            (bool) $logout->getCookie('refresh_token', false)?->isCleared(),
        );
        $this->withUnencryptedCookie('refresh_token', $rotated)
            ->postJson('/api/auth/refresh', [], ['X-Requested-With' => 'fetch'])
            ->assertUnauthorized();
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
