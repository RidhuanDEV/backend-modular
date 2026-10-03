import asyncio
import logging
import time
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi.sse import ServerSentEvent
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from app.core.clock import now
from app.core.context import Context
from app.core.errors import ApiError
from app.core.runtime import Runtime
from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import (
    CreateNotification,
    NotificationResponse,
    public_notification,
)
from app.modules.users.repository import user_by_id
from app.platform.jobs.models import EmailJob, NotificationCounter

logger = logging.getLogger(__name__)


async def create(
    ctx: Context, dto: CreateNotification, run: Runtime
) -> NotificationResponse:
    # Serialize first-counter creation by locking the recipient before the counter.
    recipient = await user_by_id(ctx.session, dto.recipientId, lock=True)
    if recipient is None:
        raise ApiError(404, "Recipient not found")
    counter = await ctx.session.scalar(
        select(NotificationCounter)
        .where(NotificationCounter.recipient_id == recipient.id)
        .with_for_update()
    )
    if counter is None:
        counter = NotificationCounter(recipient_id=recipient.id, sequence=0)
        ctx.session.add(counter)
    counter.sequence += 1
    row = Notification(
        recipient_id=recipient.id,
        actor_id=ctx.require_actor().id,
        title=dto.title,
        sequence=counter.sequence,
        body=dto.body,
        email_status=("PENDING" if run.settings.smtp_enabled else "FAILED")
        if dto.sendEmail
        else "NOT_REQUESTED",
    )
    ctx.session.add(row)
    await ctx.session.flush()
    if dto.sendEmail and run.settings.smtp_enabled:
        ctx.session.add(
            EmailJob(
                notification_id=row.id,
                recipient=recipient.email,
                title=dto.title,
                body=dto.body,
            )
        )
    response = public_notification(row)
    await ctx.commit(row.id, after=response)
    return response


async def list_own(
    ctx: Context, after: UUID | None = None
) -> tuple[list[NotificationResponse], str | None]:
    position = await cursor(ctx, after)
    statement = select(Notification).where(
        Notification.recipient_id == ctx.require_actor().id
    )
    if position is not None:
        statement = statement.where(Notification.sequence < position)
    rows = await ctx.session.scalars(
        statement.order_by(Notification.sequence.desc()).limit(51)
    )
    values = list(rows)
    return [public_notification(row) for row in values[:50]], str(values[49].id) if len(
        values
    ) > 50 else None


async def mark_read(ctx: Context, id: UUID) -> NotificationResponse:
    row = await ctx.session.scalar(
        select(Notification)
        .where(
            Notification.id == id, Notification.recipient_id == ctx.require_actor().id
        )
        .with_for_update()
    )
    if row is None:
        raise ApiError(404, "Notification not found")
    before = public_notification(row)
    row.read_at = row.read_at or now()
    response = public_notification(row)
    await ctx.commit(id, before=before, after=response)
    return response


async def cursor(ctx: Context, last_id: UUID | None) -> int | None:
    if last_id is None:
        return None
    row = await ctx.session.scalar(
        select(Notification).where(
            Notification.id == last_id,
            Notification.recipient_id == ctx.require_actor().id,
        )
    )
    if row is None:
        raise ApiError(400, "Unknown notification cursor")
    return row.sequence


async def stream(
    run: Runtime, recipient: UUID, expiry: int, after: int | None
) -> AsyncIterator[ServerSentEvent]:
    deadline = min(
        time.monotonic() + 14 * 60, time.monotonic() + max(0, expiry - time.time())
    )
    last_heartbeat = 0.0
    unread_only = after is None
    while time.monotonic() < deadline:
        try:
            async with run.sessions() as session:
                if await user_by_id(session, recipient) is None:
                    return
                statement = select(Notification).where(
                    Notification.recipient_id == recipient
                )
                if after is not None:
                    statement = statement.where(Notification.sequence > after)
                if unread_only:
                    statement = statement.where(Notification.read_at.is_(None))
                rows = list(
                    await session.scalars(
                        statement.order_by(Notification.sequence).limit(50)
                    )
                )
                responses = [public_notification(row) for row in rows]
                sequences = [row.sequence for row in rows]
        except DBAPIError:
            # Headers are already sent. Finish the stream without provider payloads.
            logger.warning("Notification stream database unavailable")
            return
        # No database session or transaction is held while writing/waiting on clients.
        for item, sequence in zip(responses, sequences, strict=True):
            yield ServerSentEvent(
                raw_data=item.model_dump_json(), event="notification", id=str(item.id)
            )
            after = sequence
        if time.monotonic() - last_heartbeat >= 15:
            yield ServerSentEvent(comment="heartbeat")
            last_heartbeat = time.monotonic()
        if len(responses) < 50:
            await asyncio.sleep(3)
