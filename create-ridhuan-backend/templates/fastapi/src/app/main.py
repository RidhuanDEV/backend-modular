import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.routing import APIRoute
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.exc import DBAPIError

from app.api.dependencies import AppRuntime
from app.api.middleware import PolicyMiddleware
from app.api.registry import REGISTRY, EndpointId, Policy, policies
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

# Pinned with Subresource Integrity so a CDN compromise cannot run script on the docs page.
# Hashes match the swagger-ui-dist@5.34.1 npm tarball; update version and hashes together.
SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1"
SWAGGER_UI_HTML = f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API documentation</title>
<link rel="stylesheet" href="{SWAGGER_UI}/swagger-ui.css" integrity="sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="{SWAGGER_UI}/swagger-ui-bundle.js" integrity="sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z" crossorigin="anonymous"></script>
<script>
SwaggerUIBundle({{
  url: "/docs/openapi.json",
  dom_id: "#swagger-ui",
  layout: "BaseLayout",
  deepLinking: true,
  showExtensions: true,
  showCommonExtensions: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
}});
</script>
</body>
</html>
"""

REFRESH_COOKIE_OPERATIONS = {
    EndpointId.LOGIN.value,
    EndpointId.REFRESH.value,
    EndpointId.LOGOUT.value,
}
REFRESH_COOKIE_MODES = (
    "Refresh token transport is set by REFRESH_TOKEN_TRANSPORT. "
    "body (default): the refresh token travels in JSON. "
    "cookie: login and refresh set it as an httpOnly cookie scoped to /api/auth "
    "and omit it from the response body; refresh and logout read the cookie when "
    "the body has no refreshToken, and then require the X-Requested-With header "
    '(send credentials: "include" cross-origin). '
    "A refreshToken in the body always takes precedence."
)


def document_refresh_cookie(operation: dict[str, JsonValue]) -> None:
    """Documents both refresh token transports on the endpoints that use them."""
    operation_id = operation.get("operationId")
    operation["description"] = REFRESH_COOKIE_MODES
    responses = operation.get("responses")
    if not isinstance(responses, dict):
        return
    logout = operation_id == EndpointId.LOGOUT.value
    success = responses.get("204" if logout else "200")
    if isinstance(success, dict):
        success["headers"] = {
            "Set-Cookie": {
                "description": "Cookie mode only: clears the refresh cookie"
                if logout
                else "Cookie mode only: httpOnly refresh token cookie (Path=/api/auth)",
                "schema": {"type": "string"},
            }
        }
    if operation_id == EndpointId.LOGIN.value:
        return
    parameters = operation.get("parameters")
    operation["parameters"] = [
        *(parameters if isinstance(parameters, list) else []),
        {
            "name": "X-Requested-With",
            "in": "header",
            "required": False,
            "description": "Required (any value) when the refresh token comes from the cookie",
            "schema": {"type": "string"},
        },
    ]


def error_statuses(
    policy: Policy, operation: dict[str, JsonValue], path: str
) -> dict[int, str]:
    """Statuses the request pipeline can produce for one operation."""
    endpoint = policy.id
    write = policy.method != "GET"
    body = "requestBody" in operation
    docs = policy.module == "docs"
    codes: dict[int, str] = {}
    if body or write or operation.get("parameters"):
        codes[400] = "Validation failed or malformed request"
    if policy.authenticated or endpoint in {EndpointId.LOGIN, EndpointId.REFRESH}:
        codes[401] = "Missing, invalid or expired credentials"
    if policy.permission or endpoint in {EndpointId.REFRESH, EndpointId.LOGOUT}:
        codes[403] = "Missing permission, or refresh cookie without X-Requested-With"
    if "{" in path or endpoint == EndpointId.NOTIFICATION_CREATE:
        codes[404] = "Resource not found"
    if write:
        codes[409] = "Conflicting or still-referenced resource"
    if body:
        codes[413] = "Request body too large"
    if policy.module != "system":
        codes[429] = "Rate limit exceeded"
    codes[500] = "Unexpected server error"
    if not docs and endpoint not in {EndpointId.HEALTH, EndpointId.LIVE}:
        codes[503] = "Database or rate-limit store unavailable"
    return dict(sorted(codes.items()))


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
        # Cookie mode sends the refresh cookie cross-origin, which needs credentialed CORS
        # with the exact origin allowlist (never a wildcard).
        allow_credentials=settings.refresh_token_transport == "cookie",
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "Last-Event-ID",
            "X-Requested-With",
        ],
        expose_headers=["X-Request-ID", "X-Next-Cursor"],
    )
    feature_routers = (auth, users, roles, permissions, uploads, notifications, probes)
    for router in feature_routers:
        app.include_router(router)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, error: ApiError) -> JSONResponse:
        return JSONResponse(
            {"success": False, "message": error.message}, status_code=error.status
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            {"success": False, "message": "Invalid request"}, status_code=400
        )

    # Unexpected errors keep the envelope instead of Starlette's plain-text 500.
    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, error: Exception) -> JSONResponse:
        return JSONResponse(
            {"success": False, "message": "Internal server error"}, status_code=500
        )

    @app.exception_handler(DBAPIError)
    async def database_error(request: Request, error: DBAPIError) -> JSONResponse:
        status = database_status(error)
        return JSONResponse(
            {
                "success": False,
                "message": "Resource conflict"
                if status == 409
                else "Database unavailable",
            },
            status_code=status,
        )

    @app.get(
        "/docs",
        operation_id=EndpointId.DOCS_UI,
        response_class=HTMLResponse,
        tags=["docs"],
    )
    async def docs() -> HTMLResponse:
        return HTMLResponse(SWAGGER_UI_HTML)

    @app.get("/docs/openapi.json", operation_id=EndpointId.DOCS_SPEC, tags=["docs"])
    async def spec() -> dict[str, JsonValue]:
        return TypeAdapter[dict[str, JsonValue]](dict[str, JsonValue]).validate_python(
            app.openapi()
        )

    @app.get(
        "/docs/specs/{module}.json", operation_id=EndpointId.DOCS_MODULE, tags=["docs"]
    )
    async def module_spec(module: str, runtime: AppRuntime) -> dict[str, JsonValue]:
        ids = {
            policy.id.value
            for policy in runtime.policies.values()
            if policy.module == module
        }
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
    document.setdefault("components", {}).setdefault("securitySchemes", {})[
        "BearerAuth"
    ] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }
    # Errors use the template envelope (validation is 400, not FastAPI's 422).
    openapi_paths = TypeAdapter[dict[str, dict[str, dict[str, JsonValue]]]](
        dict[str, dict[str, dict[str, JsonValue]]]
    ).validate_python(document["paths"])
    for path, item in openapi_paths.items():
        for operation in item.values():
            responses = operation.get("responses", {})
            operation_id = operation.get("operationId")
            if not isinstance(responses, dict) or not isinstance(operation_id, str):
                continue
            for code in [code for code in responses if code >= "400"]:
                del responses[code]
            for code, description in error_statuses(
                run.policies[EndpointId(operation_id)], operation, path
            ).items():
                responses[str(code)] = {
                    "description": description,
                    "content": {
                        "application/json": {
                            "schema": {"$ref": "#/components/schemas/ErrorResponse"}
                        }
                    },
                }
            if operation_id in REFRESH_COOKIE_OPERATIONS:
                document_refresh_cookie(operation)
    document["paths"] = openapi_paths
    schemas = document["components"].setdefault("schemas", {})
    schemas.pop("HTTPValidationError", None)
    schemas.pop("ValidationError", None)
    schemas["ErrorResponse"] = {
        "type": "object",
        "required": ["success", "message"],
        "properties": {
            "success": {"type": "boolean", "enum": [False]},
            "message": {"type": "string"},
        },
    }
    return app
