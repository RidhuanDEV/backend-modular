from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid


class RefreshFamily(Base):
    __tablename__ = "refresh_families"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Guid(), ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(UTCInstant())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCInstant())
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (Index("ix_family_retention", "expires_at", "revoked_at"),)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    token_hash: Mapped[str] = mapped_column(
        String(64, collation="utf8mb4_bin").with_variant(String(64), "postgresql"), unique=True
    )
    family_id: Mapped[UUID] = mapped_column(
        Guid(), ForeignKey("refresh_families.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[UUID] = mapped_column(Guid(), ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(UTCInstant())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCInstant())
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (Index("ix_refresh_user_expiry", "user_id", "expires_at"),)
