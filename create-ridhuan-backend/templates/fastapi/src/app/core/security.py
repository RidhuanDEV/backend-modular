import hashlib
import secrets
from datetime import timedelta
from uuid import UUID

import jwt
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict

from app.core.clock import now
from app.core.errors import ApiError
from app.core.settings import Settings

passwords = PasswordHash.recommended()
_dummy = passwords.hash(secrets.token_urlsafe(32))


class Claims(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sub: UUID
    exp: int
    iat: int


def access_token(id: UUID, settings: Settings) -> str:
    instant = now()
    return jwt.encode(
        {
            "sub": str(id),
            "iat": instant,
            "exp": instant + timedelta(minutes=15),
            "iss": settings.jwt_issuer,
            "aud": settings.jwt_audience,
        },
        settings.jwt_secret.get_secret_value(),
        algorithm="HS256",
    )


def verify_access(token: str, settings: Settings) -> Claims:
    try:
        return Claims.model_validate(
            jwt.decode(
                token,
                settings.jwt_secret.get_secret_value(),
                algorithms=["HS256"],
                issuer=settings.jwt_issuer,
                audience=settings.jwt_audience,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        )
    except (jwt.InvalidTokenError, ValueError) as error:
        raise ApiError(401, "Invalid or expired token") from error


def verify_password(password: str, encoded: str | None) -> bool:
    return passwords.verify(password, encoded or _dummy)


def refresh_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
