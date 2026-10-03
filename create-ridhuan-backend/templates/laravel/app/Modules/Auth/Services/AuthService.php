<?php

declare(strict_types=1);

namespace App\Modules\Auth\Services;

use App\Modules\Auth\Data\Credentials;
use App\Modules\Auth\Data\Tokens;
use App\Modules\Auth\Models\RefreshFamily;
use App\Modules\Auth\Models\RefreshToken;
use App\Modules\Roles\Models\Role;
use App\Modules\Users\Models\User;
use App\Support\Audit\Audit;
use App\Support\Http\ApiException;
use App\Support\Time\Clock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

final class AuthService
{
    public function __construct(private readonly JwtService $jwt, private readonly Audit $audit, private readonly Clock $clock) {}

    public function register(Credentials $data): User
    {
        if (User::withTrashed()->where('email', $data->email)->exists()) {
            throw new ApiException(409, 'Email already registered');
        }
        $role = Role::query()->where('name', 'user')->first();
        if ($role === null) {
            throw new ApiException(503, 'Seed default role first');
        }
        $password = Hash::make($data->password);

        return DB::transaction(function () use ($data, $role, $password): User {
            $user = User::query()->create(['email' => $data->email, 'password' => $password, 'role_id' => $role->id]);
            $this->audit->write('REGISTER', 'user', $user->id, $user->id, after: ['id' => $user->id, 'roleId' => $user->role_id]);

            return $user;
        });
    }

    public function login(Credentials $data): Tokens
    {
        $user = User::query()->where('email', $data->email)->first();
        // Fixed bcrypt cost-12 hash: unknown accounts pay the same verification cost.
        $matches = Hash::check($data->password, $user === null ? '$2y$12$JcK1rxsdrOYpwFs/uQgkOOarUTKF1cr7MrMDF4TxrJFKNDskCgWOe' : $user->password);
        if ($user === null || ! $matches) {
            throw new ApiException(401, 'Invalid email or password');
        }
        $raw = self::opaque();
        DB::transaction(function () use ($user, $raw): void {
            $expires = $this->clock->now()->addDays(30);
            $family = RefreshFamily::query()->create(['user_id' => $user->id, 'expires_at' => $expires]);
            RefreshToken::query()->create(['family_id' => $family->id, 'user_id' => $user->id, 'token_hash' => hash('sha256', $raw), 'expires_at' => $expires]);
            $this->audit->write('LOGIN', 'auth', $family->id, $user->id, after: ['revoked' => false]);
        });

        return new Tokens($this->jwt->sign($user), $raw);
    }

    public function refresh(string $raw): Tokens
    {
        $stored = RefreshToken::query()->where('token_hash', hash('sha256', $raw))->first();
        if ($stored === null) {
            throw new ApiException(401, 'Invalid refresh token');
        }
        $replacement = self::opaque();
        $user = DB::transaction(function () use ($stored, $replacement): ?User {
            $family = RefreshFamily::query()->whereKey($stored->family_id)->lockForUpdate()->first();
            $token = RefreshToken::query()->find($stored->id);
            if ($family === null || $token === null) {
                return null;
            }
            $now = $this->clock->now();
            $actor = User::query()->find($family->user_id);
            if ($family->revoked_at !== null) {
                return null;
            }
            if ($actor === null || $family->expires_at <= $now || $token->expires_at <= $now || $token->consumed_at !== null) {
                $family->revoked_at = $now;
                $family->save();
                $this->audit->write('REPLAY', 'auth', $family->id, $actor?->id, after: ['revoked' => true]);

                return null;
            }
            $expiry = $now->addDays(30);
            $token->consumed_at = $now;
            $token->save();
            $family->expires_at = $expiry;
            $family->save();
            RefreshToken::query()->create(['family_id' => $family->id, 'user_id' => $actor->id, 'token_hash' => hash('sha256', $replacement), 'expires_at' => $expiry]);
            $this->audit->write('REFRESH', 'auth', $family->id, $actor->id, after: ['expiresAt' => $expiry->toIso8601ZuluString()]);

            return $actor;
        });
        // Rejection occurs after commit, preserving replay revocation.
        if ($user === null) {
            throw new ApiException(401, 'Invalid refresh token');
        }

        return new Tokens($this->jwt->sign($user), $replacement);
    }

    public function logout(string $raw): void
    {
        $stored = RefreshToken::query()->where('token_hash', hash('sha256', $raw))->first();
        if ($stored === null) {
            return;
        }
        DB::transaction(function () use ($stored): void {
            $family = RefreshFamily::query()->whereKey($stored->family_id)->lockForUpdate()->first();
            if ($family === null || $family->revoked_at !== null) {
                return;
            }
            $family->revoked_at = $this->clock->now();
            $family->save();
            $this->audit->write('LOGOUT', 'auth', $family->id, $family->user_id, after: ['revoked' => true]);
        });
    }

    private static function opaque(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
