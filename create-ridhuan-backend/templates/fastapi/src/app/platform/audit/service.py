import logging
import re
from uuid import UUID

from pydantic import JsonValue
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.registry import Policy
from app.platform.audit.models import ActivityLog

logger = logging.getLogger(__name__)
_SECRET_KEY = re.compile(
    r"password|token|authorization|secret|api.?key|credential|cookie", re.I
)


def scrub(value: JsonValue) -> JsonValue:
    """Defense in depth: a secret field added to a snapshot later never reaches the audit table."""
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _SECRET_KEY.search(key) else scrub(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [scrub(item) for item in value]
    return value


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
        before=scrub(before),
        after=scrub(after),
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
