from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.api.schemas import DTO
from app.modules.roles.models import Role


class Named(DTO):
    name: str = Field(min_length=1, max_length=64)


class Rename(DTO):
    name: str | None = Field(default=None, min_length=1, max_length=64)

    @field_validator("name", mode="before")
    @classmethod
    def not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("name cannot be null")
        return value


class AssignPermissions(DTO):
    permissionIds: list[UUID] = Field(min_length=1, max_length=1000)


class PermissionBrief(DTO):
    id: UUID
    name: str


class Grant(DTO):
    permission: PermissionBrief


class RoleBase(DTO):
    id: UUID
    name: str
    createdAt: datetime
    updatedAt: datetime


class RoleResponse(RoleBase):
    permissions: list[Grant]


def role_base(role: Role) -> RoleBase:
    return RoleBase(
        id=role.id, name=role.name, createdAt=role.created_at, updatedAt=role.updated_at
    )


def public_role(role: Role) -> RoleResponse:
    return RoleResponse(
        **role_base(role).model_dump(),
        permissions=[
            Grant(permission=PermissionBrief(id=grant.permission.id, name=grant.permission.name))
            for grant in role.grants
        ],
    )
