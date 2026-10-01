from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid


class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now, onupdate=now)
