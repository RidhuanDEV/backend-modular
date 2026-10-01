"""Acceptance fixture for 0001 -> latest; credentials come from the CI environment."""

import sys
from uuid import UUID

from sqlalchemy import text

from app.core.event_loop import run
from app.core.settings import Settings
from app.database.engine import create_database

ROLE = "10000000-0000-4000-8000-000000000001"
USER = "10000000-0000-4000-8000-000000000002"


async def fixture(action: str) -> None:
    engine = create_database(Settings())
    try:
        async with engine.begin() as connection:
            if action == "write":
                await connection.execute(
                    text(
                        "INSERT INTO roles (id,name,created_at,updated_at) VALUES (:id,'upgrade-fixture','2026-01-01','2026-01-01')"
                    ),
                    {"id": ROLE},
                )
                await connection.execute(
                    text(
                        "INSERT INTO users (id,email,password_hash,role_id,created_at,updated_at) VALUES (:id,'upgrade@example.test','not-a-real-hash',:role,'2026-01-01','2026-01-01')"
                    ),
                    {"id": USER, "role": ROLE},
                )
                for suffix in (3, 4):
                    await connection.execute(
                        text(
                            "INSERT INTO notifications (id,recipient_id,title,body,email_status,created_at) VALUES (:id,:recipient,'Legacy','Preserve','NOT_REQUESTED','2026-01-01')"
                        ),
                        {
                            "id": str(UUID(f"10000000-0000-4000-8000-{suffix:012d}")),
                            "recipient": USER,
                        },
                    )
            elif action == "check":
                role = await connection.scalar(
                    text("SELECT name FROM roles WHERE id=:id"), {"id": ROLE}
                )
                if role != "upgrade-fixture":
                    raise RuntimeError("Legacy role was lost")
                rows = await connection.execute(
                    text(
                        "SELECT sequence FROM notifications WHERE recipient_id=:id ORDER BY sequence"
                    ),
                    {"id": USER},
                )
                if [row[0] for row in rows] != [1, 2]:
                    raise RuntimeError("Legacy notification cursor backfill failed")
            else:
                raise ValueError("Use write or check")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    run(fixture(sys.argv[1]))
