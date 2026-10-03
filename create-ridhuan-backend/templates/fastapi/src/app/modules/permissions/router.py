from uuid import UUID

from fastapi import APIRouter, Response

from app.api.dependencies import RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.permissions import service
from app.modules.permissions.schemas import (
    Named,
    PermissionResponse,
    Rename,
    public_permission,
)

router = APIRouter(prefix="/api/permissions", tags=["permissions"])


@router.get("", operation_id=EndpointId.PERMISSION_LIST)
async def list_permissions(ctx: RequestContext) -> Success[list[PermissionResponse]]:
    return Success(data=await service.list_permissions(ctx))


@router.get("/{id}", operation_id=EndpointId.PERMISSION_GET)
async def get(id: UUID, ctx: RequestContext) -> Success[PermissionResponse]:
    return Success(data=public_permission(await service.get(ctx, id)))


@router.post("", operation_id=EndpointId.PERMISSION_CREATE, status_code=201)
async def create(dto: Named, ctx: RequestContext) -> Success[PermissionResponse]:
    return Success(data=await service.create(ctx, dto.name))


@router.patch("/{id}", operation_id=EndpointId.PERMISSION_UPDATE)
async def update(
    id: UUID, dto: Rename, ctx: RequestContext
) -> Success[PermissionResponse]:
    return Success(data=await service.update(ctx, id, dto.name))


@router.delete("/{id}", operation_id=EndpointId.PERMISSION_DELETE, status_code=204)
async def delete(id: UUID, ctx: RequestContext) -> Response:
    await service.delete(ctx, id)
    return Response(status_code=204)
