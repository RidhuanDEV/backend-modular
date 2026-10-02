from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.clock import now
from app.core.settings import Settings
from app.modules.auth.models import RefreshFamily
from app.platform.audit.models import ActivityLog
from app.platform.jobs.models import EmailJob
from app.platform.telemetry import cleanup_items, instrument


@instrument("cleanup")
async def cleanup_rows(
    factory: async_sessionmaker[AsyncSession], settings: Settings, apply: bool
) -> None:
    # Lock and delete one bounded batch per kind. Schedule repeatedly to drain.
    instant = now()
    async with factory() as session, session.begin():
        families = list(
            await session.scalars(
                select(RefreshFamily)
                .where(
                    or_(
                        RefreshFamily.revoked_at
                        < instant - timedelta(days=settings.cleanup_session_days),
                        (RefreshFamily.revoked_at.is_(None))
                        & (
                            RefreshFamily.expires_at
                            < instant - timedelta(days=settings.cleanup_session_days)
                        ),
                    )
                )
                .order_by(RefreshFamily.id)
                .limit(settings.cleanup_batch_size)
                .with_for_update(skip_locked=True)
            )
        )
        jobs = list(
            await session.scalars(
                select(EmailJob)
                .where(
                    EmailJob.status.in_(("SENT", "FAILED")),
                    EmailJob.completed_at < instant - timedelta(days=settings.cleanup_outbox_days),
                )
                .order_by(EmailJob.id)
                .limit(settings.cleanup_batch_size)
                .with_for_update(skip_locked=True)
            )
        )
        logs = (
            list(
                await session.scalars(
                    select(ActivityLog)
                    .where(
                        ActivityLog.created_at
                        < instant - timedelta(days=settings.cleanup_audit_days)
                    )
                    .order_by(ActivityLog.id)
                    .limit(settings.cleanup_batch_size)
                    .with_for_update(skip_locked=True)
                )
            )
            if settings.cleanup_audit_enabled
            else []
        )
        print(
            f"{'delete' if apply else 'candidate'} families={len(families)} outbox={len(jobs)} audit={len(logs)}"
        )
        if apply:
            for family in families:
                await session.delete(family)
            for job in jobs:
                await session.delete(job)
            for log in logs:
                await session.delete(log)
    cleanup_items("family", len(families), apply)
    cleanup_items("outbox", len(jobs), apply)
    cleanup_items("audit", len(logs), apply)
