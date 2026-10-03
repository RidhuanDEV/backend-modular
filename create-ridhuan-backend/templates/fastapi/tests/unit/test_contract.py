import asyncio
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import httpx
import pytest
from pydantic import SecretStr, ValidationError
from starlette.types import Message, Receive, Scope, Send

from app.api.middleware import PolicyMiddleware
from app.api.registry import REGISTRY, EndpointId
from app.core.clock import in_zone
from app.core.event_loop import run
from app.core.runtime import Runtime
from app.core.settings import Settings
from app.main import create_app


def settings() -> Settings:
    return Settings(jwt_secret=SecretStr("fixture-only-secret-000000000000000000"))


@pytest.mark.parametrize("provider", ["mysql", "postgresql"])
def test_provider_identifier_limits(
    provider: Literal["mysql", "postgresql"],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Isolate provider validation from the consumer's generated provider marker.
    monkeypatch.chdir(tmp_path)
    user_limit = 32 if provider == "mysql" else 63
    database_limit = 64 if provider == "mysql" else 63

    def configuration(user: int, database: int) -> Settings:
        return Settings(
            db_provider=provider,
            database_url=SecretStr(
                f"{provider}://{'u' * user}:fixture@localhost:5432/{'d' * database}"
            ),
            jwt_secret=SecretStr("identifier_fixture_secret_0123456789abcdef"),
        )

    configuration(user_limit, database_limit)
    with pytest.raises(ValidationError, match="username"):
        configuration(user_limit + 1, database_limit)
    with pytest.raises(ValidationError, match="database"):
        configuration(user_limit, database_limit + 1)


def test_registry_and_openapi() -> None:
    app = create_app(settings())
    document = app.openapi()
    ids = [
        operation["operationId"]
        for path in document["paths"].values()
        for operation in path.values()
    ]
    assert set(ids) == {id.value for id in EndpointId}
    assert len(ids) == len(REGISTRY)
    inventory = json.loads(Path("contracts/endpoints.json").read_text(encoding="utf-8"))
    assert isinstance(inventory, list)
    assert inventory == [
        {
            "id": policy.id.value,
            "method": policy.method,
            "path": policy.path,
            "module": policy.module,
            "status": policy.status,
            "audit": policy.audit,
            "rateLimit": policy.rate,
            "cache": policy.cache,
            "permission": policy.permission,
            "authenticated": policy.authenticated,
        }
        for policy in REGISTRY.values()
    ]
    assert (
        document["paths"]["/api/auth/login"]["post"]["x-policy"]["rateLimit"] == "auth"
    )
    assert (
        document["paths"]["/api/notifications"]["post"]["x-policy"]["permission"]
        == "manage_notifications"
    )


def test_configuration_rejects_unsafe_deployment() -> None:
    with pytest.raises(ValidationError):
        Settings(
            jwt_secret=SecretStr("x" * 40), environment="production", cors_origins=""
        )
    with pytest.raises(ValidationError):
        Settings(jwt_secret=SecretStr("x" * 40), app_instance_count=2)
    with pytest.raises(ValueError):
        create_app(
            Settings(
                jwt_secret=SecretStr("x" * 40),
                endpoint_policies_json='{"unknown.route":{}}',
            )
        )
    with pytest.raises(ValueError):
        create_app(
            Settings(
                jwt_secret=SecretStr("x" * 40),
                endpoint_policies_json='{"user.get":{"audit":"required"}}',
            )
        )


def test_iana_zones_and_dst() -> None:
    instant = datetime(2026, 1, 1, tzinfo=UTC)
    assert [
        in_zone(instant, zone).hour
        for zone in ("Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura")
    ] == [7, 8, 9]
    assert (
        in_zone(instant, "America/New_York").utcoffset()
        != in_zone(datetime(2026, 7, 1, tzinfo=UTC), "America/New_York").utcoffset()
    )


def test_live_cors_validation_and_login_limiter() -> None:
    async def check() -> None:
        config = settings().model_copy(
            update={
                "rate_limit_auth_max": 1,
                "database_url": SecretStr(
                    f"{settings().db_provider}://backend:backend@127.0.0.1:1/unavailable"
                ),
            }
        )
        app = create_app(config)
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://fixture"
            ) as client,
        ):
            assert (await client.get("/live")).status_code == 200
            assert (await client.get("/ready")).status_code == 503
            for origin, allowed in (
                ("http://localhost:5173", True),
                ("https://denied.example", False),
            ):
                response = await client.get("/live", headers={"Origin": origin})
                assert ("access-control-allow-origin" in response.headers) == allowed
            assert (await client.get("/live")).status_code == 200
            assert (await client.post("/api/auth/login", json={})).status_code == 400
            assert (await client.post("/api/auth/login", json={})).status_code == 429

    run(check())


def test_sse_expiry_completes_response_and_cancels_producer() -> None:
    async def check() -> None:
        app = create_app(settings())
        runtime: object = app.state.runtime
        assert isinstance(runtime, Runtime)
        sent: list[Message] = []
        producer_closed = False

        async def producer(scope: Scope, receive: Receive, send: Send) -> None:
            nonlocal producer_closed
            scope["state"] = {"token_expiry": int(time.time())}
            try:
                await send(
                    {"type": "http.response.start", "status": 200, "headers": []}
                )
                await asyncio.sleep(60)
            finally:
                producer_closed = True

        async def receive() -> Message:
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message: Message) -> None:
            sent.append(message)

        scope: Scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/notifications/stream",
            "headers": [],
            "client": ("127.0.0.1", 1234),
        }
        async with app.router.lifespan_context(app):
            await PolicyMiddleware(producer, runtime)(scope, receive, send)
        assert producer_closed
        assert [message["type"] for message in sent] == [
            "http.response.start",
            "http.response.body",
        ]
        assert sent[-1]["body"] == b""
        assert sent[-1]["more_body"] is False

    run(check())
