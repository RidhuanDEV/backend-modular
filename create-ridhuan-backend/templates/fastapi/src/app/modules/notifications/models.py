from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid

EmailStatus = Literal["NOT_REQUESTED", "PENDING", "SENT", "FAILED"]


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    recipient_id: Mapped[UUID] = mapped_column(Guid(), ForeignKey("users.id", ondelete="CASCADE"))
    actor_id: Mapped[UUID | None] = mapped_column(
        Guid(), ForeignKey("users.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(160))
    sequence: Mapped[int] = mapped_column(BigInteger)
    body: Mapped[str] = mapped_column(String(4000))
    email_status: Mapped[EmailStatus] = mapped_column(String(16), default="NOT_REQUESTED")
    read_at: Mapped[datetime | None] = mapped_column(UTCInstant())
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (
        UniqueConstraint("recipient_id", "sequence", name="uq_notification_sequence"),
        Index("ix_notification_recipient_time", "recipient_id", "created_at", "id"),
        CheckConstraint(
            "email_status IN ('NOT_REQUESTED','PENDING','SENT','FAILED')",
            name="ck_notification_email_status",
        ),
    )
