from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid
from app.modules.roles.models import Role


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role_id: Mapped[UUID] = mapped_column(Guid(), ForeignKey("roles.id"), index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCInstant())
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now, onupdate=now)
    role: Mapped[Role] = relationship(lazy="selectin")
