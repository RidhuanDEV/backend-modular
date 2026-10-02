from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid


class EmailJob(Base):
    __tablename__ = "email_jobs"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    notification_id: Mapped[UUID] = mapped_column(
        Guid(), ForeignKey("notifications.id", ondelete="CASCADE"), unique=True
    )
    recipient: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(4000))
    status: Mapped[str] = mapped_column(String(16), default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    lease_until: Mapped[datetime | None] = mapped_column(UTCInstant())
    lease_id: Mapped[UUID | None] = mapped_column(Guid())
    completed_at: Mapped[datetime | None] = mapped_column(UTCInstant())
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (Index("ix_email_claim", "status", "available_at", "lease_until"),)


class NotificationCounter(Base):
    __tablename__ = "notification_counters"
    recipient_id: Mapped[UUID] = mapped_column(
        Guid(), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sequence: Mapped[int] = mapped_column(BigInteger, default=0)
