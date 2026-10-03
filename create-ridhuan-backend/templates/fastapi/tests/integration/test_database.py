import asyncio
import json
import logging
import os
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select, text

from app.cli.seed import seed
from app.core.event_loop import run
from app.core.security import verify_access
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.main import create_app
from app.modules.auth.schemas import AuthUser, Tokens
from app.modules.notifications.schemas import NotificationResponse
from app.modules.roles.models import Role
from app.modules.users.models import User
from app.platform.audit.models import ActivityLog

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL"), reason="Real PostgreSQL/MySQL required"
)


def test_database_http_auth_rbac_audit_notifications() -> None:
    async def check() -> None:
        provider = os.getenv("TEST_DB_PROVIDER", "postgresql")
        config = Settings(
            jwt_secret=SecretStr("fixture-only-secret-000000000000000000"),
            db_provider="mysql" if provider == "mysql" else "postgresql",
            database_url=SecretStr(os.environ["TEST_DATABASE_URL"]),
            admin_email="admin@example.test",
            admin_password=SecretStr("Fixture-password-20261001"),
            rate_limit_auth_max=1000,
        )
        await seed(config)
        await seed(config)
        app = create_app(config)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://fixture"
            ) as client,
        ):
            response = await client.post(
                "/api/auth/login",
                json={
                    "email": config.admin_email,
                    "password": config.admin_password.get_secret_value()
                    if config.admin_password
                    else "",
                },
            )
            assert response.status_code == 200, response.text
            tokens = Tokens.model_validate(response.json()["data"])
            claims = verify_access(tokens.token, config)
            assert claims.exp - claims.iat == 900
            admin = {"Authorization": f"Bearer {tokens.token}"}
            assert (await client.get("/ready")).status_code == 200
            projected = await client.get(
                "/api/users?fields=id,email&limit=1", headers=admin
            )
            assert projected.status_code == 200, projected.text
            assert len(projected.json()["data"]) == 1
            assert set(projected.json()["data"][0]) == {"id", "email"}
            assert (
                await client.get("/api/users?fields=password", headers=admin)
            ).status_code == 400
            role_id = (await client.get("/api/auth/me", headers=admin)).json()["data"][
                "roleId"
            ]
            unchanged = await client.patch(
                f"/api/roles/{role_id}", headers=admin, json={}
            )
            assert unchanged.status_code == 200, unchanged.text
            assert (
                await client.patch(
                    f"/api/roles/{role_id}", headers=admin, json={"name": None}
                )
            ).status_code == 400
            response = await client.post(
                "/api/auth/register",
                json={
                    "email": f"recipient-{uuid4()}@example.test",
                    "password": "recipient-password",
                },
            )
            assert response.status_code == 201, response.text
            user = AuthUser.model_validate(response.json()["data"])
            assert set(response.json()["data"]) == {
                "id",
                "email",
                "roleId",
                "createdAt",
                "updatedAt",
            }
            recipient = Tokens.model_validate(
                (
                    await client.post(
                        "/api/auth/login",
                        json={"email": user.email, "password": "recipient-password"},
                    )
                ).json()["data"]
            )
            own = {"Authorization": f"Bearer {recipient.token}"}
            assert (await client.get("/api/users", headers=own)).status_code == 403
            notification = await client.post(
                "/api/notifications",
                headers=admin,
                json={
                    "recipientId": str(user.id),
                    "title": "Hello WITA",
                    "body": "Persisted notification",
                },
            )
            assert notification.status_code == 201, notification.text
            item = NotificationResponse.model_validate(notification.json()["data"])
            listed = await client.get("/api/notifications", headers=own)
            assert any(row["id"] == str(item.id) for row in listed.json()["data"])
            assert (
                await client.patch(f"/api/notifications/{item.id}/read", headers=admin)
            ).status_code == 404
            assert (
                await client.patch(f"/api/notifications/{item.id}/read", headers=own)
            ).json()["data"]["readAt"] is not None
            # Concurrent rotation: replay invalidates the entire family, including the winner.
            rotated = await asyncio.gather(
                *[
                    client.post(
                        "/api/auth/refresh",
                        json={"refreshToken": recipient.refreshToken},
                    )
                    for _ in range(2)
                ]
            )
            assert sorted(response.status_code for response in rotated) == [200, 401]
            winner = next(
                response for response in rotated if response.status_code == 200
            )
            next_tokens = Tokens.model_validate(winner.json()["data"])
            assert (
                await client.post(
                    "/api/auth/refresh", json={"refreshToken": next_tokens.refreshToken}
                )
            ).status_code == 401
            # Audit stores only DTO snapshots, with UTC instants.
            engine = create_database(config)
            try:
                async with sessions(engine)() as session:
                    logs = list(
                        await session.scalars(
                            select(ActivityLog).where(ActivityLog.entity_id == user.id)
                        )
                    )
                    assert logs and logs[0].created_at.utcoffset() is not None
                    assert "password" not in str(logs[0].after).lower()
                    assert (
                        await session.scalar(
                            select(func.count())
                            .select_from(User)
                            .where(User.email == config.admin_email)
                        )
                        == 1
                    )
            finally:
                await engine.dispose()
            # Safe soft delete revokes access even when JWT is unexpired.
            assert (
                await client.delete(f"/api/users/{user.id}", headers=admin)
            ).status_code == 204
            assert (await client.get("/api/auth/me", headers=own)).status_code == 401
            assert (
                await client.post(
                    "/api/auth/logout", json={"refreshToken": tokens.refreshToken}
                )
            ).status_code == 204
            assert (
                await client.post(
                    "/api/auth/refresh", json={"refreshToken": tokens.refreshToken}
                )
            ).status_code == 401

    run(check())


def test_required_audit_rolls_back_and_optional_audit_commits(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def check() -> None:
        provider = os.getenv("TEST_DB_PROVIDER", "postgresql")
        config = Settings(
            jwt_secret=SecretStr("fixture-only-secret-000000000000000000"),
            db_provider="mysql" if provider == "mysql" else "postgresql",
            database_url=SecretStr(os.environ["TEST_DATABASE_URL"]),
            admin_email="admin@example.test",
            admin_password=SecretStr("Fixture-password-20261001"),
            rate_limit_auth_max=1000,
        )
        await seed(config)
        request_id = str(uuid4())
        suffix = uuid4().hex
        constraint = "reject_audit_" + suffix
        engine = create_database(config)
        try:
            async with engine.begin() as connection:
                await connection.execute(
                    text(
                        f"ALTER TABLE activity_logs ADD CONSTRAINT {constraint} CHECK (request_id <> '{request_id}')"
                    )
                )
            for audit, expected in (("required", 503), ("optional", 201)):
                settings = config.model_copy(
                    update={
                        "endpoint_policies_json": json.dumps(
                            {"role.create": {"audit": audit}}
                        )
                    }
                )
                app = create_app(settings)
                logging.getLogger().addHandler(caplog.handler)
                name = f"audit-{audit}-{suffix}"
                async with (
                    app.router.lifespan_context(app),
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=app),
                        base_url="http://fixture",
                    ) as client,
                ):
                    login = await client.post(
                        "/api/auth/login",
                        json={
                            "email": config.admin_email,
                            "password": "Fixture-password-20261001",
                        },
                    )
                    assert login.status_code == 200, login.text
                    tokens = Tokens.model_validate(login.json()["data"])
                    created = await client.post(
                        "/api/roles",
                        headers={
                            "Authorization": f"Bearer {tokens.token}",
                            "X-Request-ID": request_id,
                        },
                        json={"name": name},
                    )
                    assert created.status_code == expected, created.text
                    if audit == "optional":
                        duplicate = await client.post(
                            "/api/roles",
                            headers={"Authorization": f"Bearer {tokens.token}"},
                            json={"name": name},
                        )
                        assert duplicate.status_code == 409, duplicate.text
                        assert duplicate.json() == {
                            "success": False,
                            "message": "Resource conflict",
                        }
                async with sessions(engine)() as session:
                    count = await session.scalar(
                        select(func.count()).select_from(Role).where(Role.name == name)
                    )
                    assert count == (1 if audit == "optional" else 0)
            assert any(
                record.message == "Optional audit persistence failed"
                for record in caplog.records
            )
        finally:
            async with engine.begin() as connection:
                operation = "CHECK" if config.db_provider == "mysql" else "CONSTRAINT"
                await connection.execute(
                    text(f"ALTER TABLE activity_logs DROP {operation} {constraint}")
                )
            await engine.dispose()

    run(check())
