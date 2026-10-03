import math
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.sql.elements import ColumnElement

from app.core.clock import now
from app.core.context import Context
from app.core.errors import ApiError
from app.core.runtime import Runtime
from app.core.security import passwords
from app.modules.roles.repository import role_within_actor
from app.modules.users.models import User
from app.modules.users.repository import user_by_id
from app.modules.users.schemas import (
    CreateUser,
    Pagination,
    UpdateUser,
    UserList,
    UserQuery,
    UserResponse,
    project_user,
    public_user,
)


async def get_user(ctx: Context, id: UUID, run: Runtime) -> UserResponse:
    key = await run.cache.key(ctx.session, f"user:{id}")
    if ctx.policy.cache == "read":
        cached = await run.cache.get(key, UserResponse)
        if cached:
            return cached
    user = await user_by_id(ctx.session, id)
    if user is None:
        raise ApiError(404, "User not found")
    response = public_user(user)
    if ctx.policy.cache == "read":
        await run.cache.set(key, response)
    return response


async def list_users(ctx: Context, query: UserQuery) -> UserList:
    conditions: list[ColumnElement[bool]] = [User.deleted_at.is_(None)]
    if query.search:
        conditions.append(
            func.lower(User.email).contains(query.search.lower(), autoescape=True)
        )
    total = (
        await ctx.session.scalar(
            select(func.count()).select_from(User).where(*conditions)
        )
        or 0
    )
    column = {
        "email": User.email,
        "createdAt": User.created_at,
        "updatedAt": User.updated_at,
    }[query.sortBy]
    order = column.desc() if query.orderBy == "desc" else column.asc()
    rows = await ctx.session.scalars(
        select(User)
        .where(*conditions)
        .order_by(order, User.id)
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
    )
    return UserList(
        data=[project_user(row, query.fields) for row in rows],
        meta=Pagination(
            page=query.page,
            limit=query.limit,
            totalItems=total,
            totalPages=math.ceil(total / query.limit),
            hasNextPage=query.page * query.limit < total,
            hasPrevPage=query.page > 1,
        ),
    )


async def create(ctx: Context, dto: CreateUser) -> UserResponse:
    role = await role_within_actor(ctx.session, ctx.require_actor(), dto.roleId)
    user = User(
        email=str(dto.email),
        password_hash=await ctx.work.run(passwords.hash, dto.password),
        role_id=role.id,
        role=role,
    )
    ctx.session.add(user)
    await ctx.session.flush()
    response = public_user(user)
    await ctx.commit(user.id, after=response)
    return response


async def update_user(ctx: Context, id: UUID, dto: UpdateUser) -> UserResponse:
    user = await user_by_id(ctx.session, id, lock=True)
    if user is None:
        raise ApiError(404, "User not found")
    await role_within_actor(ctx.session, ctx.require_actor(), user.role_id)
    before = public_user(user)
    if dto.roleId is not None:
        user.role = await role_within_actor(
            ctx.session, ctx.require_actor(), dto.roleId
        )
        user.role_id = dto.roleId
    if dto.email is not None:
        user.email = str(dto.email)
    await ctx.session.flush()
    response = public_user(user)
    await ctx.commit(id, before=before, after=response)
    return response


async def delete_user(ctx: Context, id: UUID) -> None:
    actor = ctx.require_actor()
    if actor.id == id:
        raise ApiError(403, "Cannot delete your own account")
    user = await user_by_id(ctx.session, id, lock=True)
    if user is None:
        raise ApiError(404, "User not found")
    await role_within_actor(ctx.session, actor, user.role_id)
    before = public_user(user)
    user.deleted_at = now()
    await ctx.commit(id, before=before)
