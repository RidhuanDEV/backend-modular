import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from alembic.autogenerate.api import AutogenContext
from sqlalchemy import Connection

from app.core.event_loop import run as run_async
from app.core.settings import Settings
from app.database import models  # noqa: F401
from app.database.base import Base, UTCInstant
from app.database.engine import create_database
from app.database.types import Guid

config = context.config
settings = Settings(jwt_secret=os.getenv("JWT_SECRET", "migration-design-only-secret-00000000"))
config.set_main_option(
    "version_locations",
    str(Path(config.get_main_option("script_location")) / settings.db_provider / "versions"),
)
if config.config_file_name:
    fileConfig(config.config_file_name)


def render_item(kind: str, value: object, autogenerate: AutogenContext) -> str | bool:
    if kind == "type" and isinstance(value, Guid):
        autogenerate.imports.add("from app.database.types import Guid")
        return "Guid()"
    if kind == "type" and isinstance(value, UTCInstant):
        autogenerate.imports.add("from app.database.base import UTCInstant")
        return "UTCInstant()"
    return False


def run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        compare_type=True,
        user_module_prefix="",
        render_item=render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


async def online() -> None:
    engine = create_database(settings)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run)
    finally:
        await engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Use online release migrations against the selected engine")
else:
    run_async(online())
