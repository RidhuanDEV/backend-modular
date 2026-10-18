from fastapi import Request, Response

from app.core.errors import ApiError
from app.core.settings import Settings
from app.modules.auth.schemas import PublicTokens, Tokens

COOKIE_PATH = "/api/auth"
# Matches the refresh token lifetime; the server still enforces the real expiry.
COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60


# Opt-in httpOnly cookie transport for the refresh token (REFRESH_TOKEN_TRANSPORT=cookie).
# The token never reaches JavaScript, and because browsers attach cookies automatically,
# cookie-authenticated refresh/logout requests must carry X-Requested-With: a custom
# header forces a CORS preflight, so only allowlisted origins can send it.
def enabled(settings: Settings) -> bool:
    return settings.refresh_token_transport == "cookie"


def issue(response: Response, tokens: Tokens, settings: Settings) -> PublicTokens:
    """Sets the cookie and strips the token from the body in cookie mode."""
    if not enabled(settings):
        return PublicTokens(token=tokens.token, refreshToken=tokens.refreshToken)
    response.set_cookie(
        settings.refresh_cookie_name,
        tokens.refreshToken,
        max_age=COOKIE_MAX_AGE_SECONDS,
        path=COOKIE_PATH,
        domain=settings.refresh_cookie_domain,
        secure=settings.refresh_cookie_secure,
        httponly=True,
        samesite=settings.refresh_cookie_samesite,
    )
    return PublicTokens(token=tokens.token)


def clear(response: Response, settings: Settings) -> None:
    if enabled(settings):
        response.delete_cookie(
            settings.refresh_cookie_name,
            path=COOKIE_PATH,
            domain=settings.refresh_cookie_domain,
            secure=settings.refresh_cookie_secure,
            httponly=True,
            samesite=settings.refresh_cookie_samesite,
        )


def token(request: Request, body_token: str | None, settings: Settings) -> str:
    """A body token always wins; otherwise cookie mode reads the httpOnly cookie."""
    if body_token:
        return body_token
    if enabled(settings):
        value = request.cookies.get(settings.refresh_cookie_name)
        if value:
            if not request.headers.get("X-Requested-With"):
                raise ApiError(
                    403, "Cookie-based refresh requires the X-Requested-With header"
                )
            return value
    raise ApiError(400, "refreshToken is required")
