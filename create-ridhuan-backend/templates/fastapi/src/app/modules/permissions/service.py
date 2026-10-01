from uuid import UUID

from sqlalchemy import select

from app.core.context import Context
from app.core.errors import ApiError
from app.modules.permissions.models import Permission
from app.modules.permissions.schemas import PermissionResponse, public_permission
from app.modules.roles.repository import permissions_within_actor


async def get(ctx: Context, id: UUID) -> Permission:
    value = await ctx.session.get(Permission, id)
    if value is None:
        raise ApiError(404, "Permission not found")
    return value


async def list_permissions(ctx: Context) -> list[PermissionResponse]:
    return [
        public_permission(row)
        for row in await ctx.session.scalars(
            select(Permission).order_by(Permission.name, Permission.id)
        )
    ]


async def create(ctx: Context, name: str) -> PermissionResponse:
    row = Permission(name=name)
    ctx.session.add(row)
    await ctx.session.flush()
    response = public_permission(row)
    await ctx.commit(row.id, after=response)
    return response


async def update(ctx: Context, id: UUID, name: str | None) -> PermissionResponse:
    await permissions_within_actor(ctx.require_actor(), {id})
    row = await get(ctx, id)
    before = public_permission(row)
    if name is not None:
        row.name = name
    await ctx.session.flush()
    response = public_permission(row)
    await ctx.commit(id, before=before, after=response)
    return response


async def delete(ctx: Context, id: UUID) -> None:
    await permissions_within_actor(ctx.require_actor(), {id})
    row = await get(ctx, id)
    before = public_permission(row)
    await ctx.session.delete(row)
    await ctx.commit(id, before=before)
