from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.clock import now
from app.database.base import Base, UTCInstant
from app.database.types import Guid
from app.modules.permissions.models import Permission


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[UUID] = mapped_column(Guid(), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCInstant(), default=now, onupdate=now)
    grants: Mapped[list["RolePermission"]] = relationship(
        lazy="selectin", cascade="all, delete-orphan", passive_deletes=True
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    role_id: Mapped[UUID] = mapped_column(
        Guid(), ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission_id: Mapped[UUID] = mapped_column(
        Guid(), ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    permission: Mapped[Permission] = relationship(lazy="selectin")
