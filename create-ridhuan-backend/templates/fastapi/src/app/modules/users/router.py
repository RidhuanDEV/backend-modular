from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query, Response

from app.api.dependencies import AppRuntime, RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.users import service
from app.modules.users.schemas import (
    CreateUser,
    UpdateUser,
    UserList,
    UserQuery,
    UserResponse,
)

router = APIRouter(prefix="/api/users", tags=["user"])


@router.get("", operation_id=EndpointId.USER_LIST, response_model_exclude_unset=True)
async def list_users(
    query: Annotated[UserQuery, Query()], ctx: RequestContext
) -> UserList:
    return await service.list_users(ctx, query)


@router.get("/{id}", operation_id=EndpointId.USER_GET)
async def get_user(
    id: UUID, ctx: RequestContext, run: AppRuntime
) -> Success[UserResponse]:
    return Success(data=await service.get_user(ctx, id, run))


@router.post("", operation_id=EndpointId.USER_CREATE, status_code=201)
async def create(dto: CreateUser, ctx: RequestContext) -> Success[UserResponse]:
    return Success(data=await service.create(ctx, dto))


@router.patch("/{id}", operation_id=EndpointId.USER_UPDATE)
async def update(
    id: UUID, dto: UpdateUser, ctx: RequestContext
) -> Success[UserResponse]:
    return Success(data=await service.update_user(ctx, id, dto))


@router.delete("/{id}", operation_id=EndpointId.USER_DELETE, status_code=204)
async def delete(id: UUID, ctx: RequestContext) -> Response:
    await service.delete_user(ctx, id)
    return Response(status_code=204)
