import argparse
import asyncio
import importlib.util
import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import uvicorn
from alembic import command
from alembic.config import Config
from alembic.script import Script
from sqlalchemy import select

from app.cli.generate import generate_module
from app.cli.seed import seed
from app.core.clock import now
from app.core.event_loop import run
from app.core.logging import configure_logging
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.main import create_app
from app.modules.uploads.models import StoredFile
from app.platform.jobs.cleanup import cleanup_rows
from app.platform.jobs.worker import worker
from app.platform.storage.service import Storage
from app.platform.telemetry import cleanup_items, setup, shutdown


class Arguments(argparse.Namespace):
    command: str
    apply: bool
    dry_run: bool
    name: str | None
    revision: str


def migration_config(settings: Settings) -> Config:
    config = Config("alembic.ini")
    config.set_main_option(
        "version_locations", str(Path("migrations") / settings.db_provider / "versions")
    )
    return config


async def cleanup(settings: Settings, apply: bool) -> None:
    setup(settings)
    engine = create_database(settings)
    storage = Storage(settings)
    cutoff = now() - timedelta(hours=settings.upload_orphan_grace_hours)
    try:
        await cleanup_rows(sessions(engine), settings, apply)
        # Inventory is bounded by storage paging. Recheck metadata immediately before deletion.
        iterator = storage.objects()
        candidates = 0
        while True:
            if candidates >= settings.cleanup_batch_size:
                break
            item = await asyncio.to_thread(next, iterator, None)
            if item is None:
                break
            if item.modified >= cutoff:
                continue
            async with sessions(engine)() as session:
                if (
                    await session.scalar(
                        select(StoredFile.id).where(StoredFile.object_key == item.key)
                    )
                    is None
                ):
                    print(f"{'delete' if apply else 'candidate'}: {item.key}")
                    candidates += 1
                    if apply:
                        # A fresh query immediately before touching storage prevents stale inventory decisions.
                        async with sessions(engine)() as check:
                            if (
                                await check.scalar(
                                    select(StoredFile.id).where(StoredFile.object_key == item.key)
                                )
                                is None
                            ):
                                await storage.delete(item.key)
                                cleanup_items("upload", 1, True)
                    else:
                        cleanup_items("upload", 1, False)
    finally:
        await engine.dispose()
        await storage.close()
        await asyncio.to_thread(shutdown)


def main() -> None:
    parser = argparse.ArgumentParser(description="Explicit backend operations")
    parser.add_argument(
        "command",
        choices=[
            "serve",
            "worker",
            "migrate",
            "seed",
            "cleanup",
            "openapi",
            "check-migrations",
            "generate-module",
            "revision",
        ],
    )
    parser.add_argument("name", nargs="?")
    parser.add_argument("--revision", default="head", help="migrate up to an Alembic revision")
    cleanup_mode = parser.add_mutually_exclusive_group()
    cleanup_mode.add_argument("--apply", action="store_true")
    cleanup_mode.add_argument("--dry-run", action="store_true")
    args = Arguments()
    parser.parse_args(namespace=args)
    if args.command == "generate-module":
        if args.name is None:
            parser.error("generate-module requires a snake_case module name")
        generate_module(args.name)
        return
    settings = Settings()
    configure_logging()
    if args.command == "serve":
        uvicorn.run(
            "app.main:create_app",
            factory=True,
            host="0.0.0.0",
            port=settings.port,
            proxy_headers=False,
            access_log=False,
            log_config=None,
            loop="app.core.event_loop:loop_factory",
        )
    elif args.command == "migrate":
        command.upgrade(migration_config(settings), args.revision)
    elif args.command == "revision":
        if not args.name:
            parser.error("revision requires a migration message")
        if importlib.util.find_spec("ruff") is None:
            parser.error(
                "revision requires development tools; run uv sync --locked --extra "
                + settings.db_provider
            )
        revision = command.revision(
            migration_config(settings), message=args.name, autogenerate=True
        )
        if not isinstance(revision, Script):
            raise RuntimeError("Expected one migration revision")
        subprocess.run([sys.executable, "-m", "ruff", "check", revision.path, "--fix"], check=True)
        subprocess.run([sys.executable, "-m", "ruff", "format", revision.path], check=True)
    elif args.command == "check-migrations":
        command.check(migration_config(settings))
    elif args.command == "seed":
        run(seed(settings))
    elif args.command == "cleanup":
        run(cleanup(settings, args.apply))
    elif args.command == "worker":
        run(worker(settings))
    elif args.command == "openapi":
        print(json.dumps(create_app(settings).openapi(), indent=2))


if __name__ == "__main__":
    main()
