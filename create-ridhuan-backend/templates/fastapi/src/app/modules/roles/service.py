from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.core.context import Context
from app.core.errors import ApiError
from app.modules.permissions.models import Permission
from app.modules.roles.models import Role, RolePermission
from app.modules.roles.repository import permissions_within_actor, role_within_actor
from app.modules.roles.schemas import RoleBase, RoleResponse, public_role, role_base
from app.modules.users.models import User


async def list_roles(ctx: Context) -> list[RoleResponse]:
    return [
        public_role(row)
        for row in await ctx.session.scalars(select(Role).order_by(Role.name, Role.id))
    ]


async def create(ctx: Context, name: str) -> RoleBase:
    role = Role(name=name)
    ctx.session.add(role)
    await ctx.session.flush()
    response = role_base(role)
    await ctx.commit(role.id, after=response)
    return response


async def update_role(ctx: Context, id: UUID, name: str | None) -> RoleBase:
    role = await role_within_actor(ctx.session, ctx.require_actor(), id)
    before = public_role(role)
    if name is not None:
        role.name = name
    await ctx.session.flush()
    response = role_base(role)
    await ctx.commit(id, before=before, after=response)
    return response


async def delete_role(ctx: Context, id: UUID) -> None:
    role = await role_within_actor(ctx.session, ctx.require_actor(), id)
    if await ctx.session.scalar(select(User.id).where(User.role_id == id).limit(1)):
        raise ApiError(409, "Role is still assigned to users")
    before = public_role(role)
    await ctx.session.delete(role)
    await ctx.commit(id, before=before)


async def assign(ctx: Context, id: UUID, ids: list[UUID]) -> RoleResponse:
    role = await role_within_actor(ctx.session, ctx.require_actor(), id)
    before = public_role(role)
    selected = set(ids)
    await permissions_within_actor(ctx.require_actor(), selected)
    found = set(
        await ctx.session.scalars(
            select(Permission.id).where(Permission.id.in_(selected))
        )
    )
    if found != selected:
        raise ApiError(404, "Permission not found")
    await ctx.session.execute(
        delete(RolePermission).where(RolePermission.role_id == id)
    )
    ctx.session.add_all(
        [
            RolePermission(role_id=id, permission_id=permission)
            for permission in selected
        ]
    )
    await ctx.session.flush()
    # Refresh the loaded relationship after replacing grants.
    role = await ctx.session.scalar(
        select(Role)
        .where(Role.id == id)
        .options(selectinload(Role.grants))
        .execution_options(populate_existing=True)
    )
    if role is None:
        raise ApiError(404, "Role not found")
    response = public_role(role)
    await ctx.commit(id, before=before, after=response)
    return response
