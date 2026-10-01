from dataclasses import dataclass, replace
from enum import StrEnum
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict, TypeAdapter

from app.core.settings import Settings

AuditMode = Literal["required", "optional", "none"]
RateGroup = Literal["auth", "public", "internal"]
CacheMode = Literal["read", "off"]
PermissionName = Literal[
    "manage_users", "manage_roles", "manage_permissions", "manage_uploads", "manage_notifications"
]


class EndpointId(StrEnum):
    HEALTH = "health.get"
    LIVE = "live.get"
    READY = "ready.get"
    DOCS_SPEC = "docs.spec"
    DOCS_MODULE = "docs.moduleSpec"
    DOCS_UI = "docs.ui"
    REGISTER = "auth.register"
    LOGIN = "auth.login"
    REFRESH = "auth.refresh"
    LOGOUT = "auth.logout"
    ME = "auth.me"
    USER_LIST = "user.list"
    USER_GET = "user.get"
    USER_CREATE = "user.create"
    USER_UPDATE = "user.update"
    USER_DELETE = "user.delete"
    ROLE_LIST = "role.list"
    ROLE_GET = "role.get"
    ROLE_CREATE = "role.create"
    ROLE_UPDATE = "role.update"
    ROLE_DELETE = "role.delete"
    ROLE_GRANTS = "role.assignPermissions"
    PERMISSION_LIST = "permission.list"
    PERMISSION_GET = "permission.get"
    PERMISSION_CREATE = "permission.create"
    PERMISSION_UPDATE = "permission.update"
    PERMISSION_DELETE = "permission.delete"
    UPLOAD_CREATE = "upload.create"
    UPLOAD_GET = "upload.get"
    NOTIFICATION_CREATE = "notification.create"
    NOTIFICATION_LIST = "notification.list"
    NOTIFICATION_READ = "notification.read"
    NOTIFICATION_STREAM = "notification.stream"


@dataclass(frozen=True)
class Policy:
    id: EndpointId
    method: Literal["GET", "POST", "PATCH", "DELETE"]
    path: str
    module: str
    status: int = 200
    audit: AuditMode = "none"
    rate: RateGroup = "internal"
    cache: CacheMode = "off"
    authenticated: bool = True
    permission: PermissionName | None = None


_policies = [
    Policy(EndpointId.HEALTH, "GET", "/health", "system", rate="public", authenticated=False),
    Policy(EndpointId.LIVE, "GET", "/live", "system", rate="public", authenticated=False),
    Policy(EndpointId.READY, "GET", "/ready", "system", rate="public", authenticated=False),
    Policy(
        EndpointId.DOCS_SPEC,
        "GET",
        "/docs/openapi.json",
        "docs",
        rate="public",
        authenticated=False,
    ),
    Policy(
        EndpointId.DOCS_MODULE,
        "GET",
        "/docs/specs/{module}.json",
        "docs",
        rate="public",
        authenticated=False,
    ),
    Policy(EndpointId.DOCS_UI, "GET", "/docs", "docs", rate="public", authenticated=False),
    Policy(
        EndpointId.REGISTER,
        "POST",
        "/api/auth/register",
        "auth",
        201,
        "required",
        "auth",
        authenticated=False,
    ),
    Policy(
        EndpointId.LOGIN,
        "POST",
        "/api/auth/login",
        "auth",
        audit="optional",
        rate="auth",
        authenticated=False,
    ),
    Policy(
        EndpointId.REFRESH, "POST", "/api/auth/refresh", "auth", rate="auth", authenticated=False
    ),
    Policy(
        EndpointId.LOGOUT, "POST", "/api/auth/logout", "auth", 204, rate="auth", authenticated=False
    ),
    Policy(EndpointId.ME, "GET", "/api/auth/me", "auth"),
    Policy(EndpointId.USER_LIST, "GET", "/api/users", "user", permission="manage_users"),
    Policy(
        EndpointId.USER_GET,
        "GET",
        "/api/users/{id}",
        "user",
        cache="read",
        permission="manage_users",
    ),
    Policy(
        EndpointId.USER_CREATE,
        "POST",
        "/api/users",
        "user",
        201,
        "required",
        permission="manage_users",
    ),
    Policy(
        EndpointId.USER_UPDATE,
        "PATCH",
        "/api/users/{id}",
        "user",
        audit="required",
        permission="manage_users",
    ),
    Policy(
        EndpointId.USER_DELETE,
        "DELETE",
        "/api/users/{id}",
        "user",
        204,
        "required",
        permission="manage_users",
    ),
    Policy(EndpointId.ROLE_LIST, "GET", "/api/roles", "roles", permission="manage_roles"),
    Policy(
        EndpointId.ROLE_GET,
        "GET",
        "/api/roles/{id}",
        "roles",
        permission="manage_roles",
    ),
    Policy(
        EndpointId.ROLE_CREATE,
        "POST",
        "/api/roles",
        "roles",
        201,
        "required",
        permission="manage_roles",
    ),
    Policy(
        EndpointId.ROLE_UPDATE,
        "PATCH",
        "/api/roles/{id}",
        "roles",
        audit="required",
        permission="manage_roles",
    ),
    Policy(
        EndpointId.ROLE_DELETE,
        "DELETE",
        "/api/roles/{id}",
        "roles",
        204,
        "required",
        permission="manage_roles",
    ),
    Policy(
        EndpointId.ROLE_GRANTS,
        "POST",
        "/api/roles/{id}/permissions",
        "roles",
        audit="required",
        permission="manage_roles",
    ),
    Policy(
        EndpointId.PERMISSION_LIST,
        "GET",
        "/api/permissions",
        "permissions",
        permission="manage_permissions",
    ),
    Policy(
        EndpointId.PERMISSION_GET,
        "GET",
        "/api/permissions/{id}",
        "permissions",
        permission="manage_permissions",
    ),
    Policy(
        EndpointId.PERMISSION_CREATE,
        "POST",
        "/api/permissions",
        "permissions",
        201,
        "required",
        permission="manage_permissions",
    ),
    Policy(
        EndpointId.PERMISSION_UPDATE,
        "PATCH",
        "/api/permissions/{id}",
        "permissions",
        audit="required",
        permission="manage_permissions",
    ),
    Policy(
        EndpointId.PERMISSION_DELETE,
        "DELETE",
        "/api/permissions/{id}",
        "permissions",
        204,
        "required",
        permission="manage_permissions",
    ),
    Policy(
        EndpointId.UPLOAD_CREATE,
        "POST",
        "/api/upload",
        "upload",
        201,
        "required",
        permission="manage_uploads",
    ),
    Policy(
        EndpointId.UPLOAD_GET,
        "GET",
        "/api/upload/{id}",
        "upload",
        permission="manage_uploads",
    ),
    Policy(
        EndpointId.NOTIFICATION_CREATE,
        "POST",
        "/api/notifications",
        "notifications",
        201,
        "required",
        permission="manage_notifications",
    ),
    Policy(EndpointId.NOTIFICATION_LIST, "GET", "/api/notifications", "notifications"),
    Policy(
        EndpointId.NOTIFICATION_READ,
        "PATCH",
        "/api/notifications/{id}/read",
        "notifications",
        audit="required",
    ),
    Policy(EndpointId.NOTIFICATION_STREAM, "GET", "/api/notifications/stream", "notifications"),
]
REGISTRY = MappingProxyType({policy.id: policy for policy in _policies})


class Override(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audit: AuditMode | None = None
    cache: CacheMode | None = None
    rateLimit: RateGroup | None = None


def policies(settings: Settings) -> dict[EndpointId, Policy]:
    overrides = TypeAdapter(dict[EndpointId, Override]).validate_json(
        settings.endpoint_policies_json
    )
    result = dict(REGISTRY)
    for id, override in overrides.items():
        base = result[id]
        if override.audit in {"required", "optional"} and base.audit == "none":
            raise ValueError(f"{id} has no audit producer")
        if override.cache == "read" and base.cache != "read":
            raise ValueError(f"{id} has no cache adapter")
        result[id] = replace(
            base,
            audit=override.audit or base.audit,
            cache=override.cache or base.cache,
            rate=override.rateLimit or base.rate,
        )
    return result
