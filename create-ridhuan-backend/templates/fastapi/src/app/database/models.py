"""Explicit model imports for Alembic metadata discovery."""

from app.modules.auth.models import RefreshFamily, RefreshToken
from app.modules.notifications.models import Notification
from app.modules.permissions.models import Permission
from app.modules.roles.models import Role, RolePermission
from app.modules.uploads.models import StoredFile
from app.modules.users.models import User
from app.platform.audit.models import ActivityLog
from app.platform.cache.models import CacheGeneration
from app.platform.jobs.models import EmailJob, NotificationCounter

__all__ = [
    "ActivityLog",
    "CacheGeneration",
    "EmailJob",
    "NotificationCounter",
    "Notification",
    "Permission",
    "RefreshToken",
    "RefreshFamily",
    "Role",
    "RolePermission",
    "StoredFile",
    "User",
]
