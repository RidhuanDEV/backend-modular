from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.api.dependencies import AppRuntime, RequestContext
from app.api.registry import EndpointId
from app.api.schemas import Success
from app.modules.notifications import service
from app.modules.notifications.schemas import CreateNotification, NotificationResponse
from app.platform.telemetry import sse_connection

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.post("", operation_id=EndpointId.NOTIFICATION_CREATE, status_code=201)
async def create(
    dto: CreateNotification, ctx: RequestContext, run: AppRuntime
) -> Success[NotificationResponse]:
    return Success(data=await service.create(ctx, dto, run))


@router.get(
    "",
    operation_id=EndpointId.NOTIFICATION_LIST,
    responses={
        200: {
            "headers": {
                "X-Next-Cursor": {
                    "description": "UUID cursor for the next page; absent on final page",
                    "schema": {"type": "string", "format": "uuid"},
                }
            }
        }
    },
)
async def list_own(
    ctx: RequestContext,
    response: Response,
    cursor: Annotated[UUID | None, Query()] = None,
) -> Success[list[NotificationResponse]]:
    values, next_cursor = await service.list_own(ctx, cursor)
    if next_cursor is not None:
        response.headers["X-Next-Cursor"] = next_cursor
    return Success(data=values)


@dataclass(frozen=True)
class StreamAccess:
    recipient: UUID
    expiry: int
    after: int | None


async def stream_access(
    ctx: RequestContext, last_event_id: Annotated[UUID | None, Header()] = None
) -> StreamAccess:
    # Validate access and cursor before headers. Only immutable values survive
    # the function-scoped database session; polling opens its own short sessions.
    return StreamAccess(
        ctx.require_actor().id,
        ctx.token_expiry or 0,
        await service.cursor(ctx, last_event_id),
    )


@router.get(
    "/stream",
    operation_id=EndpointId.NOTIFICATION_STREAM,
    response_class=EventSourceResponse,
)
async def stream(
    run: AppRuntime, access: Annotated[StreamAccess, Depends(stream_access)]
) -> AsyncIterator[ServerSentEvent]:
    sse_connection(1)
    try:
        async for event in service.stream(
            run, access.recipient, access.expiry, access.after
        ):
            yield event
    finally:
        sse_connection(-1)


@router.patch("/{id}/read", operation_id=EndpointId.NOTIFICATION_READ)
async def mark_read(id: UUID, ctx: RequestContext) -> Success[NotificationResponse]:
    return Success(data=await service.mark_read(ctx, id))
