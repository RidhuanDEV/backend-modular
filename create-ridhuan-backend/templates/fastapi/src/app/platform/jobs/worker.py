import asyncio
import logging
import signal
from dataclasses import dataclass
from datetime import timedelta
from types import FrameType
from uuid import UUID, uuid4

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.clock import now
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.modules.notifications.models import Notification
from app.platform.jobs.models import EmailJob
from app.platform.mail.service import send_notification
from app.platform.telemetry import (
    email_attempt,
    instrument,
    outbox_state,
    setup,
    shutdown,
)

logger = logging.getLogger(__name__)
RETRY_SECONDS = (5, 30, 120, 600)


@dataclass(frozen=True)
class Claim:
    id: UUID
    notification: UUID
    lease: UUID
    recipient: str
    title: str
    body: str
    attempts: int


async def claim(
    factory: async_sessionmaker[AsyncSession], settings: Settings
) -> Claim | None:
    async with factory() as session, session.begin():
        instant = now()
        job = await session.scalar(
            select(EmailJob)
            .where(
                or_(
                    (EmailJob.status == "PENDING") & (EmailJob.available_at <= instant),
                    (EmailJob.status == "PROCESSING")
                    & (EmailJob.lease_until <= instant),
                )
            )
            .order_by(EmailJob.available_at, EmailJob.id)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if job is None:
            return None
        if job.attempts >= settings.worker_max_attempts:
            job.status = "FAILED"
            job.completed_at = instant
            job.lease_id = None
            job.lease_until = None
            await session.execute(
                update(Notification)
                .where(Notification.id == job.notification_id)
                .values(email_status="FAILED")
            )
            return None
        job.status = "PROCESSING"
        job.attempts += 1
        lease = uuid4()
        job.lease_id = lease
        job.lease_until = instant + timedelta(seconds=settings.worker_lease_seconds)
        return Claim(
            job.id,
            job.notification_id,
            lease,
            job.recipient,
            job.title,
            job.body,
            job.attempts,
        )


async def renew(
    factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    item: Claim,
    done: asyncio.Event,
    lost: asyncio.Event,
) -> None:
    while not done.is_set():
        try:
            await asyncio.wait_for(done.wait(), timeout=settings.worker_renew_seconds)
            return
        except TimeoutError:
            pass
        try:
            async with factory() as session, session.begin():
                job = await session.scalar(
                    select(EmailJob).where(EmailJob.id == item.id).with_for_update()
                )
                if (
                    job is None
                    or job.lease_id != item.lease
                    or job.status != "PROCESSING"
                    or job.lease_until is None
                    or job.lease_until <= now()
                ):
                    lost.set()
                    return
                job.lease_until = now() + timedelta(
                    seconds=settings.worker_lease_seconds
                )
        except Exception:
            lost.set()
            logger.warning("Email lease renewal failed", extra={"job_id": str(item.id)})
            return


@instrument("email")
async def deliver(
    factory: async_sessionmaker[AsyncSession], settings: Settings, item: Claim
) -> None:
    done, lost = asyncio.Event(), asyncio.Event()
    renewal = asyncio.create_task(renew(factory, settings, item, done, lost))
    success = False
    try:
        async with asyncio.timeout(25):
            await send_notification(settings, item.recipient, item.title, item.body)
        success = True
    except Exception:
        logger.warning(
            "Email attempt failed",
            extra={"job_id": str(item.id), "attempt": item.attempts},
        )
    finally:
        done.set()
        await renewal
    if lost.is_set():
        return
    async with factory() as session, session.begin():
        job = await session.scalar(
            select(EmailJob).where(EmailJob.id == item.id).with_for_update()
        )
        if (
            job is None
            or job.lease_id != item.lease
            or job.lease_until is None
            or job.lease_until <= now()
        ):
            return
        job.lease_id = None
        job.lease_until = None
        if success or item.attempts >= settings.worker_max_attempts:
            job.status = "SENT" if success else "FAILED"
            job.completed_at = now()
            await session.execute(
                update(Notification)
                .where(Notification.id == item.notification)
                .values(email_status=job.status)
            )
        else:
            job.status = "PENDING"
            job.available_at = now() + timedelta(
                seconds=RETRY_SECONDS[item.attempts - 1]
            )
    email_attempt(
        "SENT"
        if success
        else "FAILED"
        if item.attempts >= settings.worker_max_attempts
        else "RETRY"
    )


async def worker(settings: Settings) -> None:
    if not settings.smtp_enabled:
        logger.info("SMTP disabled; worker is idle until shutdown")
        idle = asyncio.Event()
        loop = asyncio.get_running_loop()
        previous = {
            signum: signal.getsignal(signum)
            for signum in (signal.SIGINT, signal.SIGTERM)
        }

        def halt_idle(_signum: int, _frame: FrameType | None) -> None:
            loop.call_soon_threadsafe(idle.set)

        for signum in previous:
            signal.signal(signum, halt_idle)
        try:
            await idle.wait()
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
        return
    setup(settings)
    engine = create_database(settings)
    factory = sessions(engine)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    previous = {
        signum: signal.getsignal(signum) for signum in (signal.SIGINT, signal.SIGTERM)
    }

    def halt(_signum: int, _frame: FrameType | None) -> None:
        loop.call_soon_threadsafe(stop.set)

    for signum in previous:
        signal.signal(signum, halt)

    async def consume() -> None:
        while not stop.is_set():
            try:
                async with factory() as session:
                    count = await session.scalar(
                        select(func.count())
                        .select_from(EmailJob)
                        .where(EmailJob.status.in_(("PENDING", "PROCESSING")))
                    )
                    oldest = await session.scalar(
                        select(func.min(EmailJob.created_at)).where(
                            EmailJob.status.in_(("PENDING", "PROCESSING"))
                        )
                    )
                    outbox_state(
                        count or 0,
                        (now() - oldest).total_seconds() if oldest is not None else 0,
                    )
                item = await claim(factory, settings)
                if item is not None:
                    await deliver(factory, settings, item)
                    continue
            except Exception:
                logger.warning("Email worker database unavailable")
            try:
                await asyncio.wait_for(
                    stop.wait(), timeout=settings.worker_poll_seconds
                )
            except TimeoutError:
                pass

    try:
        await asyncio.gather(*(consume() for _ in range(settings.worker_concurrency)))
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
        await engine.dispose()
        await asyncio.to_thread(shutdown)
