from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid


class StoredFile(Base):
    __tablename__ = "stored_files"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    storage: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="READY")
    object_key: Mapped[str] = mapped_column(
        String(255, collation="utf8mb4_bin").with_variant(String(255), "postgresql"),
        unique=True,
    )
    original_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(128))
    size: Mapped[int]
    uploader_id: Mapped[UUID | None] = mapped_column(
        Guid(), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (
        Index("ix_file_uploader_created", "uploader_id", "created_at"),
        Index("ix_file_created", "created_at"),
    )
