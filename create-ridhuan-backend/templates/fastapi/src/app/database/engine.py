import ssl

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.settings import Settings


def create_database(settings: Settings) -> AsyncEngine:
    url = make_url(settings.database_url.get_secret_value())
    url = url.set(
        drivername="postgresql+psycopg"
        if settings.db_provider == "postgresql"
        else "mysql+aiomysql"
    )
    connect_args: dict[str, str | int | ssl.SSLContext] = (
        {"options": "-c timezone=UTC", "connect_timeout": 3}
        if settings.db_provider == "postgresql"
        else {
            "init_command": "SET time_zone = '+00:00'",
            "connect_timeout": 3,
            "charset": "utf8mb4",
        }
    )
    if settings.db_provider == "mysql" and url.password is not None:
        # aiomysql 0.3.2 turns password strings into latin1 bytes in every auth
        # branch. The bootstrap stores UTF-8 credentials; preserve those exact
        # bytes at this driver boundary, including non-Latin passwords.
        connect_args["password"] = url.password.encode("utf-8").decode("latin1")
    if settings.db_provider == "postgresql":
        connect_args["sslmode"] = settings.database_tls
        if settings.database_ca_file is not None:
            connect_args["sslrootcert"] = str(settings.database_ca_file)
    elif settings.database_tls == "verify-full":
        connect_args["ssl"] = ssl.create_default_context(
            cafile=str(settings.database_ca_file) if settings.database_ca_file else None
        )
    return create_async_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=5,
        pool_timeout=3,
    )


def sessions(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
