from fastapi import APIRouter, Response

from app.api.dependencies import AppRuntime, RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.auth import service
from app.modules.auth.schemas import AuthUser, Login, Refresh, Register, Tokens

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", operation_id=EndpointId.REGISTER, status_code=201)
async def register(dto: Register, ctx: RequestContext) -> Success[AuthUser]:
    return Success(data=await service.register(ctx, dto))


@router.post("/login", operation_id=EndpointId.LOGIN)
async def login(dto: Login, ctx: RequestContext, run: AppRuntime) -> Success[Tokens]:
    return Success(data=await service.login(ctx, dto, run.settings))


@router.post("/refresh", operation_id=EndpointId.REFRESH)
async def refresh(
    dto: Refresh, ctx: RequestContext, run: AppRuntime
) -> Success[Tokens]:
    return Success(data=await service.refresh(ctx, dto.refreshToken, run.settings))


@router.post("/logout", operation_id=EndpointId.LOGOUT, status_code=204)
async def logout(dto: Refresh, ctx: RequestContext) -> Response:
    await service.logout(ctx, dto.refreshToken)
    return Response(status_code=204)


@router.get("/me", operation_id=EndpointId.ME)
async def me(ctx: RequestContext) -> Success[AuthUser]:
    return Success(data=service.public_user(ctx.require_actor()))
