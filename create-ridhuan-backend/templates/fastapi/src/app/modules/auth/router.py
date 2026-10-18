from fastapi import APIRouter, Request, Response

from app.api.dependencies import AppRuntime, RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.auth import refresh_cookie, service
from app.modules.auth.schemas import AuthUser, Login, PublicTokens, Refresh, Register

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", operation_id=EndpointId.REGISTER, status_code=201)
async def register(dto: Register, ctx: RequestContext) -> Success[AuthUser]:
    return Success(data=await service.register(ctx, dto))


@router.post("/login", operation_id=EndpointId.LOGIN, response_model_exclude_unset=True)
async def login(
    dto: Login, ctx: RequestContext, run: AppRuntime, response: Response
) -> Success[PublicTokens]:
    tokens = await service.login(ctx, dto, run.settings)
    return Success(data=refresh_cookie.issue(response, tokens, run.settings))


@router.post(
    "/refresh", operation_id=EndpointId.REFRESH, response_model_exclude_unset=True
)
async def refresh(
    dto: Refresh,
    ctx: RequestContext,
    run: AppRuntime,
    request: Request,
    response: Response,
) -> Success[PublicTokens]:
    raw = refresh_cookie.token(request, dto.refreshToken, run.settings)
    tokens = await service.refresh(ctx, raw, run.settings)
    return Success(data=refresh_cookie.issue(response, tokens, run.settings))


@router.post("/logout", operation_id=EndpointId.LOGOUT, status_code=204)
async def logout(
    dto: Refresh, ctx: RequestContext, run: AppRuntime, request: Request
) -> Response:
    await service.logout(
        ctx, refresh_cookie.token(request, dto.refreshToken, run.settings)
    )
    response = Response(status_code=204)
    refresh_cookie.clear(response, run.settings)
    return response


@router.get("/me", operation_id=EndpointId.ME)
async def me(ctx: RequestContext) -> Success[AuthUser]:
    return Success(data=service.public_user(ctx.require_actor()))
