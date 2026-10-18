<?php

declare(strict_types=1);

namespace App\Modules\Auth\Http;

use App\Modules\Auth\Data\Tokens;
use App\Support\Config\Settings;
use App\Support\Http\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie).
 * The token never reaches JavaScript, and because browsers attach cookies automatically,
 * cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom
 * header forces a CORS preflight, so only allowlisted origins can send it.
 */
final class RefreshCookie
{
    private const PATH = '/api/auth';

    /** Matches the refresh token lifetime; the server still enforces the real expiry. */
    private const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

    public static function enabled(): bool
    {
        return Settings::string('backend.refresh.transport') === 'cookie';
    }

    /** @return array{token: string, refreshToken?: string} */
    public static function body(Tokens $tokens): array
    {
        return self::enabled()
            ? ['token' => $tokens->token]
            : [
                'token' => $tokens->token,
                'refreshToken' => $tokens->refreshToken,
            ];
    }

    public static function issue(Response $response, Tokens $tokens): Response
    {
        if (self::enabled()) {
            $response->headers->setCookie(
                self::cookie($tokens->refreshToken, self::MAX_AGE_SECONDS),
            );
        }

        return $response;
    }

    public static function clear(Response $response): Response
    {
        if (self::enabled()) {
            $response->headers->setCookie(self::cookie('', -1));
        }

        return $response;
    }

    /** A body token always wins; otherwise cookie mode reads the httpOnly cookie. */
    public static function token(Request $request, ?string $bodyToken): string
    {
        if ($bodyToken !== null && $bodyToken !== '') {
            return $bodyToken;
        }
        if (self::enabled()) {
            $value = $request->cookies->get(
                Settings::string('backend.refresh.name'),
            );
            if (is_string($value) && $value !== '') {
                if (($request->headers->get('X-Requested-With') ?? '') === '') {
                    throw new ApiException(
                        403,
                        'Cookie-based refresh requires the X-Requested-With header',
                    );
                }

                return $value;
            }
        }
        throw new ApiException(400, 'refreshToken is required');
    }

    private static function cookie(string $value, int $maxAge): Cookie
    {
        $domain = Settings::string('backend.refresh.domain');

        return Cookie::create(
            Settings::string('backend.refresh.name'),
            $value,
            $maxAge < 0 ? 1 : time() + $maxAge,
            self::PATH,
            $domain === '' ? null : $domain,
            Settings::boolean('backend.refresh.secure'),
            true,
            true,
            match (Settings::string('backend.refresh.samesite')) {
                'strict' => Cookie::SAMESITE_STRICT,
                'none' => Cookie::SAMESITE_NONE,
                default => Cookie::SAMESITE_LAX,
            },
        );
    }
}
