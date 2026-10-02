import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.routing import APIRoute
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.exc import DBAPIError

from app.api.dependencies import AppRuntime
from app.api.middleware import PolicyMiddleware
from app.api.registry import REGISTRY, EndpointId, policies
from app.core.blocking import BlockingPool
from app.core.errors import ApiError
from app.core.logging import configure_logging
from app.core.runtime import Runtime
from app.core.settings import Settings
from app.database.engine import create_database, sessions
from app.database.errors import database_status
from app.modules.auth.router import router as auth
from app.modules.notifications.router import router as notifications
from app.modules.permissions.router import router as permissions
from app.modules.probes.router import router as probes
from app.modules.roles.router import router as roles
from app.modules.uploads.router import router as uploads
from app.modules.users.router import router as users
from app.platform.cache.service import Cache
from app.platform.rate_limit.service import Limiter
from app.platform.redis import redis_client
from app.platform.storage.service import Storage
from app.platform.telemetry import setup, shutdown


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()
    setup(settings)
    engine = create_database(settings)
    redis = redis_client(settings)
    run = Runtime(
        settings,
        engine,
        sessions(engine),
        redis,
        policies(settings),
        Limiter(settings, redis),
        Cache(settings, redis),
        Storage(settings),
        BlockingPool(),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        app.state.runtime = run
        try:
            yield
        finally:
            await run.work.close()
            await redis.aclose()
            await engine.dispose()
            await run.storage.close()
            await asyncio.to_thread(shutdown)

    app = FastAPI(
        title="Modular FastAPI",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.runtime = run
    app.add_middleware(PolicyMiddleware, runtime=run)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID", "Last-Event-ID"],
        expose_headers=["X-Request-ID", "X-Next-Cursor"],
    )
    feature_routers = (auth, users, roles, permissions, uploads, notifications, probes)
    for router in feature_routers:
        app.include_router(router)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse({"success": False, "message": error.message}, status_code=error.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        return JSONResponse({"success": False, "message": "Invalid request"}, status_code=400)

    @app.exception_handler(DBAPIError)
    async def database_error(request: Request, error: DBAPIError) -> JSONResponse:
        status = database_status(error)
        return JSONResponse(
            {
                "success": False,
                "message": "Resource conflict" if status == 409 else "Database unavailable",
            },
            status_code=status,
        )

    @app.get("/docs", operation_id=EndpointId.DOCS_UI, response_class=HTMLResponse, tags=["docs"])
    async def docs() -> HTMLResponse:
        return get_swagger_ui_html(openapi_url="/docs/openapi.json", title="API documentation")

    @app.get("/docs/openapi.json", operation_id=EndpointId.DOCS_SPEC, tags=["docs"])
    async def spec() -> dict[str, JsonValue]:
        return TypeAdapter[dict[str, JsonValue]](dict[str, JsonValue]).validate_python(
            app.openapi()
        )

    @app.get("/docs/specs/{module}.json", operation_id=EndpointId.DOCS_MODULE, tags=["docs"])
    async def module_spec(module: str, runtime: AppRuntime) -> dict[str, JsonValue]:
        ids = {policy.id.value for policy in runtime.policies.values() if policy.module == module}
        if not ids:
            raise ApiError(404, "Unknown module")
        document = await spec()
        paths = document.get("paths")
        if isinstance(paths, dict):
            document["paths"] = {
                path: operations
                for path, operations in paths.items()
                if isinstance(operations, dict)
                and any(
                    isinstance(operation, dict) and operation.get("operationId") in ids
                    for operation in operations.values()
                )
            }
        return document

    routes = [
        route
        for router in feature_routers
        for route in router.routes
        if isinstance(route, APIRoute)
    ] + [route for route in app.routes if isinstance(route, APIRoute)]
    actual = {EndpointId(route.operation_id) for route in routes if route.operation_id}
    if actual != set(REGISTRY) or len(routes) != len(REGISTRY):
        raise RuntimeError("Endpoint registry is incomplete or duplicated")
    for route in routes:
        if not route.operation_id:
            raise RuntimeError("Endpoint missing operation ID")
        policy = run.policies[EndpointId(route.operation_id)]
        if (
            route.path != policy.path
            or route.methods != {policy.method}
            or (route.status_code or 200) != policy.status
        ):
            raise RuntimeError(f"Endpoint contract mismatch: {policy.id}")
        route.openapi_extra = {
            "x-policy": {
                "audit": policy.audit,
                "rateLimit": policy.rate,
                "cache": policy.cache,
                "permission": policy.permission,
            }
        }
        if policy.authenticated:
            route.openapi_extra["security"] = [{"BearerAuth": []}]
    document = app.openapi()
    document.setdefault("components", {}).setdefault("securitySchemes", {})["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    # Runtime validation returns 400; do not advertise framework default 422.
    openapi_paths = TypeAdapter[dict[str, dict[str, dict[str, JsonValue]]]](
        dict[str, dict[str, dict[str, JsonValue]]]
    ).validate_python(document["paths"])
    for path in openapi_paths.values():
        for operation in path.values():
            responses = operation.get("responses", {})
            if not isinstance(responses, dict):
                continue
            if "422" in responses:
                responses["400"] = responses.pop("422")
    document["paths"] = openapi_paths
    return app
