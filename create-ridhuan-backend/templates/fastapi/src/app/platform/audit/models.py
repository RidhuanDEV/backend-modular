from datetime import datetime
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import JSON, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    user_id: Mapped[UUID | None] = mapped_column(
        Guid(), ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_id_snapshot: Mapped[UUID | None] = mapped_column(Guid())
    module: Mapped[str] = mapped_column(String(64))
    behavior: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[UUID | None] = mapped_column(Guid())
    endpoint_id: Mapped[str] = mapped_column(String(128))
    request_id: Mapped[str] = mapped_column(String(128))
    before: Mapped[JsonValue] = mapped_column(
        JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql"), nullable=True
    )
    after: Mapped[JsonValue] = mapped_column(
        JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    __table_args__ = (
        Index("ix_audit_entity_time", "module", "entity_id", "created_at"),
        Index("ix_audit_actor_time", "user_id", "created_at"),
        Index("ix_audit_endpoint_time", "endpoint_id", "created_at"),
        Index("ix_audit_created", "created_at"),
    )
