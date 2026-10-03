from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.roles.models import Role
from app.modules.users.models import User


async def role_by_id(session: AsyncSession, id: UUID) -> Role:
    role = await session.scalar(select(Role).where(Role.id == id))
    if role is None:
        raise ApiError(404, "Role not found")
    return role


async def permissions_within_actor(actor: User, ids: set[UUID]) -> None:
    if actor.role.name != "admin" and not ids <= {
        grant.permission_id for grant in actor.role.grants
    }:
        raise ApiError(403, "Cannot grant or manage permissions you do not hold")


async def role_within_actor(session: AsyncSession, actor: User, id: UUID) -> Role:
    role = await role_by_id(session, id)
    await permissions_within_actor(
        actor, {grant.permission_id for grant in role.grants}
    )
    return role
