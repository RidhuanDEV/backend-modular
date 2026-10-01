import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.api.registry import REGISTRY, EndpointId
from app.core.clock import in_zone
from app.core.event_loop import run
from app.core.settings import Settings
from app.main import create_app


def settings() -> Settings:
    return Settings(jwt_secret=SecretStr("fixture-only-secret-000000000000000000"))


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
    assert document["paths"]["/api/auth/login"]["post"]["x-policy"]["rateLimit"] == "auth"
    assert (
        document["paths"]["/api/notifications"]["post"]["x-policy"]["permission"]
        == "manage_notifications"
    )


def test_configuration_rejects_unsafe_deployment() -> None:
    with pytest.raises(ValidationError):
        Settings(jwt_secret=SecretStr("x" * 40), environment="production", cors_origins="")
    with pytest.raises(ValidationError):
        Settings(jwt_secret=SecretStr("x" * 40), app_instance_count=2)
    with pytest.raises(ValueError):
        create_app(
            Settings(jwt_secret=SecretStr("x" * 40), endpoint_policies_json='{"unknown.route":{}}')
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
        in_zone(instant, zone).hour for zone in ("Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura")
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
