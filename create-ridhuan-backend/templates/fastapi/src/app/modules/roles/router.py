from uuid import UUID

from fastapi import APIRouter, Response

from app.api.dependencies import RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.roles import service
from app.modules.roles.repository import role_by_id
from app.modules.roles.schemas import (
    AssignPermissions,
    Named,
    Rename,
    RoleBase,
    RoleResponse,
    public_role,
)

router = APIRouter(prefix="/api/roles", tags=["roles"])


@router.get("", operation_id=EndpointId.ROLE_LIST)
async def list_roles(ctx: RequestContext) -> Success[list[RoleResponse]]:
    return Success(data=await service.list_roles(ctx))


@router.get("/{id}", operation_id=EndpointId.ROLE_GET)
async def get_role(id: UUID, ctx: RequestContext) -> Success[RoleResponse]:
    return Success(data=public_role(await role_by_id(ctx.session, id)))


@router.post("", operation_id=EndpointId.ROLE_CREATE, status_code=201)
async def create(dto: Named, ctx: RequestContext) -> Success[RoleBase]:
    return Success(data=await service.create(ctx, dto.name))


@router.patch("/{id}", operation_id=EndpointId.ROLE_UPDATE)
async def update(id: UUID, dto: Rename, ctx: RequestContext) -> Success[RoleBase]:
    return Success(data=await service.update_role(ctx, id, dto.name))


@router.delete("/{id}", operation_id=EndpointId.ROLE_DELETE, status_code=204)
async def delete(id: UUID, ctx: RequestContext) -> Response:
    await service.delete_role(ctx, id)
    return Response(status_code=204)


@router.post("/{id}/permissions", operation_id=EndpointId.ROLE_GRANTS)
async def assign(
    id: UUID, dto: AssignPermissions, ctx: RequestContext
) -> Success[RoleResponse]:
    return Success(data=await service.assign(ctx, id, dto.permissionIds))
