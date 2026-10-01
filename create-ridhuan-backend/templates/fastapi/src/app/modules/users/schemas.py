from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.api.schemas import DTO
from app.core.inputs import Email
from app.modules.auth.schemas import AuthUser, Register
from app.modules.roles.schemas import PermissionBrief
from app.modules.users.models import User


class UserRole(DTO):
    id: UUID
    name: str
    permissions: list[PermissionBrief]


class UserResponse(AuthUser):
    role: UserRole


class CreateUser(Register):
    roleId: UUID


class UpdateUser(DTO):
    email: Email | None = None
    roleId: UUID | None = None

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        if value is None:
            raise ValueError("Email cannot be null")
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("roleId", mode="before")
    @classmethod
    def role_not_null(cls, value: object) -> object:
        if value is None:
            raise ValueError("Role cannot be null")
        return value


class UserQuery(DTO):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=10, ge=1, le=100)
    sortBy: Literal["email", "createdAt", "updatedAt"] = "createdAt"
    orderBy: Literal["asc", "desc"] = "desc"
    search: str = Field(default="", max_length=255)
    fields: str | None = Field(default=None, max_length=128)

    @field_validator("fields")
    @classmethod
    def public_fields(cls, value: str | None) -> str | None:
        if value is not None and (
            not value or any(field not in {"id", "email", "roleId"} for field in value.split(","))
        ):
            raise ValueError("fields allows only id,email,roleId")
        return value


class UserProjection(DTO):
    id: UUID | None = None
    email: str | None = None
    roleId: UUID | None = None


class Pagination(DTO):
    page: int
    limit: int
    totalItems: int
    totalPages: int
    hasNextPage: bool
    hasPrevPage: bool


class UserList(DTO):
    success: bool = True
    data: list[UserResponse | UserProjection]
    meta: Pagination


def public_user(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        roleId=user.role_id,
        createdAt=user.created_at,
        updatedAt=user.updated_at,
        role=UserRole(
            id=user.role.id,
            name=user.role.name,
            permissions=[
                PermissionBrief(id=grant.permission_id, name=grant.permission.name)
                for grant in user.role.grants
            ],
        ),
    )


def project_user(user: User, fields: str | None) -> UserResponse | UserProjection:
    if fields is None:
        return public_user(user)
    selected = set(fields.split(","))
    response = UserProjection()
    if "id" in selected:
        response.id = user.id
    if "email" in selected:
        response.email = user.email
    if "roleId" in selected:
        response.roleId = user.role_id
    return response
