import asyncio
import json
import logging
import os
from datetime import timedelta
from uuid import UUID, uuid4

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import func, select, text, update

from app.cli.seed import seed
from app.core.clock import now
from app.core.event_loop import run
from app.core.security import token_hash, verify_access
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.main import create_app
from app.modules.auth.models import RefreshFamily, RefreshToken
from app.modules.auth.schemas import AuthUser, Tokens
from app.modules.notifications.schemas import NotificationResponse
from app.modules.permissions.models import Permission
from app.modules.roles.models import Role, RolePermission
from app.modules.uploads.models import StoredFile
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


def test_refresh_rotation_is_capped_by_absolute_lifetime() -> None:
    async def check() -> None:
        provider = os.getenv("TEST_DB_PROVIDER", "postgresql")
        config = Settings(
            jwt_secret=SecretStr("fixture-only-secret-000000000000000000"),
            db_provider="mysql" if provider == "mysql" else "postgresql",
            database_url=SecretStr(os.environ["TEST_DATABASE_URL"]),
            admin_email="admin@example.test",
            admin_password=SecretStr("Fixture-password-20261001"),
            rate_limit_auth_max=1000,
            refresh_token_idle_days=2,
            refresh_token_absolute_days=5,
        )
        await seed(config)
        app = create_app(config)
        engine = create_database(config)
        try:
            async with (
                app.router.lifespan_context(app),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://fixture"
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

                async def lifetimes(raw: str) -> tuple[RefreshFamily, RefreshToken]:
                    async with sessions(engine)() as session:
                        token = await session.scalar(
                            select(RefreshToken).where(
                                RefreshToken.token_hash == token_hash(raw)
                            )
                        )
                        assert token is not None
                        family = await session.get(RefreshFamily, token.family_id)
                        assert family is not None
                        return family, token

                family, token = await lifetimes(tokens.refreshToken)
                created = family.expires_at
                assert timedelta(days=4, hours=23) < created - token.created_at
                assert token.expires_at - token.created_at < timedelta(days=2, hours=1)
                rotated = await client.post(
                    "/api/auth/refresh", json={"refreshToken": tokens.refreshToken}
                )
                assert rotated.status_code == 200, rotated.text
                next_tokens = Tokens.model_validate(rotated.json()["data"])
                family, _ = await lifetimes(next_tokens.refreshToken)
                # Rotation never extends the family's absolute expiry.
                assert family.expires_at == created
                async with engine.begin() as connection:
                    await connection.execute(
                        update(RefreshFamily)
                        .where(RefreshFamily.id == family.id)
                        .values(expires_at=now() - timedelta(seconds=1))
                    )
                expired = await client.post(
                    "/api/auth/refresh", json={"refreshToken": next_tokens.refreshToken}
                )
                assert expired.status_code == 401, expired.text
        finally:
            await engine.dispose()

    run(check())


def test_system_primitives_last_root_sessions_and_file_ownership() -> None:
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
        suffix = uuid4().hex[:12]
        engine = create_database(config)
        app = create_app(config)
        try:
            async with (
                app.router.lifespan_context(app),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app), base_url="http://fixture"
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
                token = Tokens.model_validate(login.json()["data"]).token
                admin = {"Authorization": f"Bearer {token}"}
                me = (await client.get("/api/auth/me", headers=admin)).json()["data"]
                async with sessions(engine)() as session:
                    permissions = {
                        row.name: row.id
                        for row in await session.scalars(select(Permission))
                    }
                    roles = {
                        row.name: row.id for row in await session.scalars(select(Role))
                    }
                # System permissions and roles are immutable and their names reserved.
                system = permissions["manage_users"]
                assert (
                    await client.patch(
                        f"/api/permissions/{system}",
                        headers=admin,
                        json={"name": f"renamed-{suffix}"},
                    )
                ).status_code == 403
                assert (
                    await client.delete(f"/api/permissions/{system}", headers=admin)
                ).status_code == 403
                custom = await client.post(
                    "/api/permissions", headers=admin, json={"name": f"custom-{suffix}"}
                )
                assert custom.status_code == 201, custom.text
                custom_id = custom.json()["data"]["id"]
                # RBAC only: a new permission is granted to every role managing permissions.
                async with sessions(engine)() as session:
                    assert await session.scalar(
                        select(func.count())
                        .select_from(RolePermission)
                        .where(
                            RolePermission.role_id == roles["admin"],
                            RolePermission.permission_id == UUID(custom_id),
                        )
                    )
                assert (
                    await client.patch(
                        f"/api/permissions/{custom_id}",
                        headers=admin,
                        json={"name": "manage_users"},
                    )
                ).status_code == 403
                assert (
                    await client.patch(
                        f"/api/permissions/{custom_id}",
                        headers=admin,
                        json={"name": f"custom-renamed-{suffix}"},
                    )
                ).status_code == 200
                assert (
                    await client.patch(
                        f"/api/roles/{roles['user']}",
                        headers=admin,
                        json={"name": f"renamed-{suffix}"},
                    )
                ).status_code == 403
                assert (
                    await client.delete(f"/api/roles/{roles['user']}", headers=admin)
                ).status_code == 403
                assert (
                    await client.post(
                        "/api/roles", headers=admin, json={"name": "admin"}
                    )
                ).status_code == 403
                # The root role must keep every system permission.
                assert (
                    await client.post(
                        f"/api/roles/{roles['admin']}/permissions",
                        headers=admin,
                        json={"permissionIds": [custom_id]},
                    )
                ).status_code == 403
                uploader = await client.post(
                    "/api/roles", headers=admin, json={"name": f"uploader-{suffix}"}
                )
                assert uploader.status_code == 201, uploader.text
                uploader_id = uploader.json()["data"]["id"]
                granted = await client.post(
                    f"/api/roles/{uploader_id}/permissions",
                    headers=admin,
                    json={"permissionIds": [str(permissions["manage_uploads"])]},
                )
                assert granted.status_code == 200, granted.text
                # A role change revokes every refresh session of that user.
                credentials = {
                    "email": f"member-{suffix}@example.test",
                    "password": "member-password",
                }
                registered = await client.post("/api/auth/register", json=credentials)
                assert registered.status_code == 201, registered.text
                member_id = registered.json()["data"]["id"]
                before = await client.post("/api/auth/login", json=credentials)
                refresh = Tokens.model_validate(before.json()["data"]).refreshToken
                assert (
                    await client.patch(
                        f"/api/users/{member_id}",
                        headers=admin,
                        json={"roleId": uploader_id},
                    )
                ).status_code == 200
                assert (
                    await client.post(
                        "/api/auth/refresh", json={"refreshToken": refresh}
                    )
                ).status_code == 401
                after = await client.post("/api/auth/login", json=credentials)
                member_token = Tokens.model_validate(after.json()["data"]).token
                member = {"Authorization": f"Bearer {member_token}"}
                # Files are readable by their uploader and root users only.
                stored = StoredFile(
                    storage="local",
                    object_key=f"fixture/{suffix}",
                    original_name="fixture.txt",
                    mime_type="text/plain",
                    size=1,
                    uploader_id=UUID(me["id"]),
                )
                async with sessions(engine)() as session, session.begin():
                    session.add(stored)
                assert (
                    await client.get(f"/api/upload/{stored.id}", headers=member)
                ).status_code == 404
                assert (
                    await client.get(f"/api/upload/{stored.id}", headers=admin)
                ).status_code == 200
                # The only holder of the system permissions cannot be demoted.
                async with sessions(engine)() as session, session.begin():
                    others = list(
                        await session.scalars(
                            select(User.id).where(
                                User.role_id == roles["admin"],
                                User.id != UUID(me["id"]),
                                User.deleted_at.is_(None),
                            )
                        )
                    )
                    await session.execute(
                        update(User)
                        .where(User.id.in_(others))
                        .values(role_id=roles["user"])
                    )
                try:
                    assert (
                        await client.patch(
                            f"/api/users/{me['id']}",
                            headers=admin,
                            json={"roleId": str(roles["user"])},
                        )
                    ).status_code == 403
                finally:
                    async with sessions(engine)() as session, session.begin():
                        await session.execute(
                            update(User)
                            .where(User.id.in_(others))
                            .values(role_id=roles["admin"])
                        )
        finally:
            await engine.dispose()

    run(check())


def test_refresh_cookie_transport_keeps_token_out_of_json() -> None:
    async def check() -> None:
        provider = os.getenv("TEST_DB_PROVIDER", "postgresql")
        config = Settings(
            jwt_secret=SecretStr("fixture-only-secret-000000000000000000"),
            db_provider="mysql" if provider == "mysql" else "postgresql",
            database_url=SecretStr(os.environ["TEST_DATABASE_URL"]),
            admin_email="admin@example.test",
            admin_password=SecretStr("Fixture-password-20261001"),
            rate_limit_auth_max=1000,
            refresh_token_transport="cookie",
            refresh_cookie_secure=False,
        )
        await seed(config)
        app = create_app(config)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://fixture"
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
            assert set(login.json()["data"]) == {"token"}
            header = login.headers["set-cookie"]
            assert "refresh_token=" in header
            assert "HttpOnly" in header
            assert "Path=/api/auth" in header
            assert "SameSite=lax" in header
            first = client.cookies.get("refresh_token")
            assert first
            # Browsers attach cookies automatically, so a bare cross-site POST must fail.
            assert (await client.post("/api/auth/refresh", json={})).status_code == 403
            refreshed = await client.post(
                "/api/auth/refresh", json={}, headers={"X-Requested-With": "fetch"}
            )
            assert refreshed.status_code == 200, refreshed.text
            assert set(refreshed.json()["data"]) == {"token"}
            rotated = client.cookies.get("refresh_token")
            assert rotated and rotated != first
            logout = await client.post(
                "/api/auth/logout", json={}, headers={"X-Requested-With": "fetch"}
            )
            assert logout.status_code == 204
            assert "Max-Age=0" in logout.headers["set-cookie"]
            assert client.cookies.get("refresh_token") is None
            assert (
                await client.post(
                    "/api/auth/refresh",
                    json={},
                    headers={"X-Requested-With": "fetch"},
                )
            ).status_code == 400
            assert (
                await client.post(
                    "/api/auth/refresh",
                    json={"refreshToken": rotated},
                )
            ).status_code == 401

    run(check())
