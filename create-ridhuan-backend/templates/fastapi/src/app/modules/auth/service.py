from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import select, update

from app.api.schemas import DTO
from app.core.clock import now
from app.core.context import Context
from app.core.errors import ApiError
from app.core.security import access_token, passwords, refresh_token, token_hash, verify_password
from app.core.settings import Settings
from app.modules.auth.models import RefreshFamily, RefreshToken
from app.modules.auth.schemas import AuthUser, Login, Register, Tokens
from app.modules.roles.models import Role
from app.modules.users.models import User
from app.modules.users.repository import user_by_email, user_by_id


def public_user(user: User) -> AuthUser:
    return AuthUser(
        id=user.id,
        email=user.email,
        roleId=user.role_id,
        createdAt=user.created_at,
        updatedAt=user.updated_at,
    )


class LoginSnapshot(DTO):
    email: str


class SessionSnapshot(DTO):
    expiresAt: datetime
    revoked: bool


async def register(ctx: Context, dto: Register) -> AuthUser:
    role = await ctx.session.scalar(select(Role).where(Role.name == "user"))
    if role is None:
        raise ApiError(503, "Default role missing; run explicit seed")
    if await user_by_email(ctx.session, str(dto.email)):
        raise ApiError(409, "Email already registered")
    encoded = await ctx.work.run(passwords.hash, dto.password)
    user = User(email=str(dto.email), password_hash=encoded, role_id=role.id)
    ctx.session.add(user)
    await ctx.session.flush()
    response = public_user(user)
    await ctx.commit(user.id, after=response, actor=user.id)
    return response


async def login(ctx: Context, dto: Login, settings: Settings) -> Tokens:
    user = await user_by_email(ctx.session, str(dto.email))
    valid = await ctx.work.run(verify_password, dto.password, user.password_hash if user else None)
    if user is None or user.deleted_at is not None or not valid:
        raise ApiError(401, "Invalid email or password")
    raw = refresh_token()
    instant = now()
    family = RefreshFamily(id=uuid4(), user_id=user.id, expires_at=instant + timedelta(days=30))
    ctx.session.add(family)
    await ctx.session.flush()
    ctx.session.add(
        RefreshToken(
            token_hash=token_hash(raw),
            family_id=family.id,
            user_id=user.id,
            expires_at=instant + timedelta(days=30),
        )
    )
    await ctx.commit(
        user.id, after=LoginSnapshot(email=user.email), invalidate_cache=False, actor=user.id
    )
    return Tokens(token=access_token(user.id, settings), refreshToken=raw)


async def refresh(ctx: Context, raw: str, settings: Settings) -> Tokens:
    token = await ctx.session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw))
    )
    if token is None:
        raise ApiError(401, "Invalid or expired refresh token")
    family = await ctx.session.scalar(
        select(RefreshFamily).where(RefreshFamily.id == token.family_id).with_for_update()
    )
    session = await ctx.session.scalar(
        select(RefreshToken)
        .where(RefreshToken.id == token.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if family is None or session is None:
        raise ApiError(401, "Invalid or expired refresh token")
    instant = now()
    user = await user_by_id(ctx.session, session.user_id)
    before = SessionSnapshot(expiresAt=family.expires_at, revoked=family.revoked_at is not None)
    if (
        family.revoked_at is not None
        or family.expires_at <= instant
        or session.revoked_at is not None
        or session.expires_at <= instant
        or user is None
    ):
        family.revoked_at = family.revoked_at or instant
        await ctx.session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == session.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=instant)
        )
        await ctx.commit(
            session.family_id,
            before=before,
            after=SessionSnapshot(expiresAt=family.expires_at, revoked=True),
            actor=session.user_id,
            invalidate_cache=False,
            behavior="REFRESH_REPLAY",
        )
        raise ApiError(401, "Invalid or expired refresh token")
    session.revoked_at = instant
    next_raw = refresh_token()
    family.expires_at = instant + timedelta(days=30)
    ctx.session.add(
        RefreshToken(
            token_hash=token_hash(next_raw),
            family_id=session.family_id,
            user_id=user.id,
            expires_at=family.expires_at,
        )
    )
    await ctx.commit(
        session.family_id,
        before=before,
        after=SessionSnapshot(expiresAt=family.expires_at, revoked=False),
        actor=user.id,
        invalidate_cache=False,
        behavior="REFRESH",
    )
    return Tokens(token=access_token(user.id, settings), refreshToken=next_raw)


async def logout(ctx: Context, raw: str) -> None:
    session = await ctx.session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw))
    )
    if session:
        family = await ctx.session.scalar(
            select(RefreshFamily).where(RefreshFamily.id == session.family_id).with_for_update()
        )
        if family is None or family.revoked_at is not None:
            return
        before = SessionSnapshot(expiresAt=family.expires_at, revoked=False)
        family.revoked_at = now()
        await ctx.session.execute(
            update(RefreshToken)
            .where(RefreshToken.family_id == session.family_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now())
        )
        await ctx.commit(
            session.family_id,
            before=before,
            after=SessionSnapshot(expiresAt=family.expires_at, revoked=True),
            actor=session.user_id,
            invalidate_cache=False,
            behavior="LOGOUT",
        )
