from datetime import datetime
from uuid import UUID

from pydantic import Field, field_validator

from app.api.schemas import DTO
from app.core.inputs import Email


class Register(DTO):
    email: Email
    password: str = Field(min_length=6, max_length=1024)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value


class Login(Register):
    password: str = Field(min_length=1, max_length=1024)


class Refresh(DTO):
    refreshToken: str = Field(min_length=1, max_length=1024)


class AuthUser(DTO):
    id: UUID
    email: str
    roleId: UUID
    createdAt: datetime
    updatedAt: datetime


class Tokens(DTO):
    token: str
    refreshToken: str
