from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.api.schemas import DTO
from app.modules.permissions.models import Permission


class Named(DTO):
    name: str = Field(min_length=1, max_length=128)


class Rename(DTO):
    name: str | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("name", mode="before")
    @classmethod
    def not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("name cannot be null")
        return value


class PermissionResponse(DTO):
    id: UUID
    name: str
    createdAt: datetime
    updatedAt: datetime


def public_permission(row: Permission) -> PermissionResponse:
    return PermissionResponse(
        id=row.id, name=row.name, createdAt=row.created_at, updatedAt=row.updated_at
    )
