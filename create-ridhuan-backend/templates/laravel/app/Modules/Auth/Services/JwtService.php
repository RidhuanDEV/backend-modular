<?php

declare(strict_types=1);

namespace App\Modules\Auth\Services;

use App\Modules\Auth\Data\AccessClaims;
use App\Modules\Users\Models\User;
use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use App\Support\Time\Clock;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Str;
use Throwable;

final class JwtService
{
    public function __construct(private readonly Clock $clock) {}

    public function sign(User $user): string
    {
        $now = $this->clock->now()->getTimestamp();

        return JWT::encode(
            [
                'sub' => $user->id,
                'id' => $user->id,
                'email' => $user->email,
                'roleId' => $user->role_id,
                'iss' => Settings::string('backend.jwt.issuer'),
                'aud' => Settings::string('backend.jwt.audience'),
                'iat' => $now,
                'nbf' => $now,
                'exp' => $now + 900,
                'tokenUse' => 'access',
            ],
            Settings::string('backend.jwt.secret'),
            'HS256',
        );
    }

    public function verify(string $token): AccessClaims
    {
        try {
            $data = JWT::decode(
                $token,
                new Key(Settings::string('backend.jwt.secret'), 'HS256'),
            );
        } catch (Throwable) {
            throw new ApiException(401, 'Invalid access token');
        }
        $values = get_object_vars($data);
        $id = $values['sub'] ?? null;
        $expiry = $values['exp'] ?? null;
        $issued = $values['iat'] ?? null;
        if (
            !is_string($id) ||
            !Str::isUuid($id) ||
            !is_int($expiry) ||
            !is_int($issued) ||
            $expiry - $issued > 900 ||
            ($values['iss'] ?? null) !==
                Settings::string('backend.jwt.issuer') ||
            ($values['aud'] ?? null) !==
                Settings::string('backend.jwt.audience') ||
            ($values['tokenUse'] ?? null) !== 'access'
        ) {
            throw new ApiException(401, 'Invalid access claims');
        }

        return new AccessClaims($id, $expiry);
    }
}
