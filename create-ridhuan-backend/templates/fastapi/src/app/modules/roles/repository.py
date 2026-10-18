from typing import get_args
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.registry import PermissionName
from app.core.clock import now
from app.core.errors import ApiError
from app.modules.auth.models import RefreshFamily, RefreshToken
from app.modules.permissions.models import Permission
from app.modules.roles.models import Role, RolePermission
from app.modules.users.models import User

# The seeded administrator role; access is decided by RBAC, only uploads trust it by name.
ROOT_ROLE = "admin"
DEFAULT_ROLE = "user"
# Code depends on these by name (registration, upload ownership, route permissions),
# so they cannot be renamed, deleted or recreated; renaming a permission would mint access.
SYSTEM_ROLES = frozenset({ROOT_ROLE, DEFAULT_ROLE})
SYSTEM_PERMISSIONS = frozenset(get_args(PermissionName))


def assert_not_system_name(names: frozenset[str], kind: str, name: str | None) -> None:
    if name is not None and name in names:
        raise ApiError(
            403, f"System {kind} '{name}' cannot be created, renamed or deleted"
        )


async def role_by_id(session: AsyncSession, id: UUID) -> Role:
    role = await session.scalar(select(Role).where(Role.id == id))
    if role is None:
        raise ApiError(404, "Role not found")
    return role


async def permissions_within_actor(actor: User, ids: set[UUID]) -> None:
    if not ids <= {grant.permission_id for grant in actor.role.grants}:
        raise ApiError(403, "Cannot grant or manage permissions you do not hold")


async def role_within_actor(session: AsyncSession, actor: User, id: UUID) -> Role:
    role = await role_by_id(session, id)
    await permissions_within_actor(
        actor, {grant.permission_id for grant in role.grants}
    )
    return role


class SystemPermissionHolders:
    """Lockout guard: every system permission must stay held by at least one active user,
    or nobody could grant it again. `lock` takes row locks on the system permissions so
    concurrent RBAC mutations serialize; `check` runs after the mutation is flushed in the
    same transaction and fails only for permissions that became unheld."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.before: set[str] = set()

    async def _unheld(self) -> set[str]:
        held = (
            select(RolePermission.permission_id)
            .join(User, User.role_id == RolePermission.role_id)
            .where(User.deleted_at.is_(None))
        )
        return set(
            await self.session.scalars(
                select(Permission.name).where(
                    Permission.name.in_(SYSTEM_PERMISSIONS),
                    Permission.id.not_in(held),
                )
            )
        )

    async def lock(self) -> "SystemPermissionHolders":
        await self.session.execute(
            select(Permission.id)
            .where(Permission.name.in_(SYSTEM_PERMISSIONS))
            .order_by(Permission.name)
            .with_for_update()
        )
        self.before = await self._unheld()
        return self

    async def check(self) -> None:
        await self.session.flush()
        lost = sorted((await self._unheld()) - self.before)
        if lost:
            raise ApiError(
                403, f"Change would leave no active user holding '{lost[0]}'"
            )


async def grant_to_permission_managers(
    session: AsyncSession, permission_id: UUID
) -> None:
    """RBAC only: a new permission goes to every role that manages permissions, so its
    creator and other permission managers can hand it out without a role-name exemption."""
    managers = await session.scalars(
        select(RolePermission.role_id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(Permission.name == "manage_permissions")
    )
    session.add_all(
        RolePermission(role_id=role_id, permission_id=permission_id)
        for role_id in managers
    )


async def revoke_user_sessions(session: AsyncSession, user_id: UUID) -> None:
    """Access changed: every refresh session must re-authenticate under the new rules."""
    instant = now()
    await session.execute(
        update(RefreshFamily)
        .where(RefreshFamily.user_id == user_id, RefreshFamily.revoked_at.is_(None))
        .values(revoked_at=instant)
    )
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=instant)
    )
