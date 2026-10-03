import asyncio

from sqlalchemy import select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.postgresql import insert as postgres_insert

from app.core.security import passwords
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.modules.permissions.models import Permission
from app.modules.roles.models import Role, RolePermission
from app.modules.users.models import User
from app.platform.cache.models import CacheGeneration

PERMISSIONS = (
    "manage_users",
    "manage_roles",
    "manage_permissions",
    "manage_uploads",
    "manage_notifications",
)


async def seed(settings: Settings) -> None:
    password = (
        settings.admin_password.get_secret_value() if settings.admin_password else ""
    )
    if len(password) < 12 or "CHANGE_ME" in password or "replace" in password:
        raise ValueError("ADMIN_PASSWORD requires a strong explicit value")
    encoded = await asyncio.to_thread(passwords.hash, password)
    engine = create_database(settings)
    try:
        async with sessions(engine)() as session:
            for name in ("admin", "user"):
                if settings.db_provider == "postgresql":
                    await session.execute(
                        postgres_insert(Role)
                        .values(name=name)
                        .on_conflict_do_nothing(index_elements=[Role.name])
                    )
                else:
                    statement = mysql_insert(Role).values(name=name)
                    await session.execute(
                        statement.on_duplicate_key_update(name=statement.inserted.name)
                    )
            admin = await session.scalar(select(Role).where(Role.name == "admin"))
            if admin is None:
                raise RuntimeError("Admin role seed failed")
            for name in PERMISSIONS:
                if settings.db_provider == "postgresql":
                    await session.execute(
                        postgres_insert(Permission)
                        .values(name=name)
                        .on_conflict_do_nothing(index_elements=[Permission.name])
                    )
                else:
                    statement = mysql_insert(Permission).values(name=name)
                    await session.execute(
                        statement.on_duplicate_key_update(name=statement.inserted.name)
                    )
                permission = await session.scalar(
                    select(Permission).where(Permission.name == name)
                )
                if permission is None:
                    raise RuntimeError("Permission seed failed")
                if settings.db_provider == "postgresql":
                    await session.execute(
                        postgres_insert(RolePermission)
                        .values(role_id=admin.id, permission_id=permission.id)
                        .on_conflict_do_nothing()
                    )
                else:
                    grant = mysql_insert(RolePermission).values(
                        role_id=admin.id, permission_id=permission.id
                    )
                    await session.execute(
                        grant.on_duplicate_key_update(
                            permission_id=grant.inserted.permission_id
                        )
                    )
            email = settings.admin_email.strip().lower()
            if settings.db_provider == "postgresql":
                await session.execute(
                    postgres_insert(User)
                    .values(email=email, password_hash=encoded, role_id=admin.id)
                    .on_conflict_do_nothing(index_elements=[User.email])
                )
                await session.execute(
                    postgres_insert(CacheGeneration)
                    .values(id=1, version=0)
                    .on_conflict_do_nothing()
                )
            else:
                user = mysql_insert(User).values(
                    email=email, password_hash=encoded, role_id=admin.id
                )
                await session.execute(
                    user.on_duplicate_key_update(email=user.inserted.email)
                )
                generation = mysql_insert(CacheGeneration).values(id=1, version=0)
                await session.execute(
                    generation.on_duplicate_key_update(id=generation.inserted.id)
                )
            await session.commit()
    finally:
        await engine.dispose()
