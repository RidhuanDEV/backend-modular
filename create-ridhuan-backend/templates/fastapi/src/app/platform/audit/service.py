import logging
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.registry import Policy
from app.platform.audit.models import ActivityLog

logger = logging.getLogger(__name__)


async def record(
    session: AsyncSession,
    policy: Policy,
    actor: UUID | None,
    entity: UUID | None,
    request_id: str,
    *,
    before: JsonValue = None,
    after: JsonValue = None,
    behavior: str | None = None,
) -> None:
    if policy.audit == "none":
        return
    log = ActivityLog(
        user_id=actor,
        actor_id_snapshot=actor,
        module=policy.module,
        behavior=behavior or policy.id.value.split(".", 1)[1].upper(),
        entity_id=entity,
        endpoint_id=policy.id.value,
        request_id=request_id,
        before=before,
        after=after,
    )
    if policy.audit == "required":
        session.add(log)
        await session.flush()
        return
    # begin_nested flushes pending business state before creating its savepoint.
    # Business persistence failures must propagate even when audit is optional.
    await session.flush()
    try:
        async with session.begin_nested():
            session.add(log)
            await session.flush()
    except Exception:
        logger.warning(
            "Optional audit persistence failed", extra={"endpoint_id": policy.id.value}
        )
