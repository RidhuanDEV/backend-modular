import asyncio

from fastapi import APIRouter
from sqlalchemy import text

from app.api.dependencies import AppRuntime
from app.api.registry import EndpointId
from app.api.schemas import DTO, Success
from app.core.errors import ApiError
from app.platform.redis import execute

router = APIRouter(tags=["system"])


class Health(DTO):
    status: str = "ok"


@router.get("/live", operation_id=EndpointId.LIVE)
async def live() -> Success[Health]:
    return Success(data=Health())


@router.get("/health", operation_id=EndpointId.HEALTH)
async def health() -> Success[Health]:
    return Success(data=Health())


@router.get("/ready", operation_id=EndpointId.READY)
async def ready(run: AppRuntime) -> Success[Health]:
    try:
        async with asyncio.timeout(4), run.sessions() as session:
            await session.execute(text("SELECT 1"))
            if run.settings.rate_limit_store == "redis":
                if await execute(run.redis, "PING") not in {"PONG", True}:
                    raise RuntimeError("Redis ping failed")
    except Exception as error:
        raise ApiError(503, "Required dependency unavailable") from error
    return Success(data=Health())
