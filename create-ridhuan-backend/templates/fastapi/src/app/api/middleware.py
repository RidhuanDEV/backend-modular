import logging
import re
import time
from uuid import UUID, uuid4

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.registry import Policy
from app.core.errors import ApiError
from app.core.runtime import Runtime

logger = logging.getLogger(__name__)


class PolicyMiddleware:
    def __init__(self, app: ASGIApp, runtime: Runtime) -> None:
        self.app = app
        self.runtime = runtime
        self.routes: list[tuple[Policy, re.Pattern[str]]] = [
            (
                policy,
                re.compile(
                    "^"
                    + re.sub(
                        r"\{[^}]+\}",
                        "[^/]+",
                        re.escape(policy.path).replace(r"\{", "{").replace(r"\}", "}"),
                    )
                    + "$"
                ),
            )
            for policy in runtime.policies.values()
        ]

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.monotonic()
        headers = list(scope.get("headers", []))
        supplied = next(
            (value.decode("latin-1") for key, value in headers if key.lower() == b"x-request-id"),
            "",
        )
        try:
            request_id = str(UUID(supplied))
        except ValueError:
            request_id = str(uuid4())
        scope["headers"] = [
            (key, value) for key, value in headers if key.lower() != b"x-request-id"
        ] + [(b"x-request-id", request_id.encode())]
        policy = next(
            (
                policy
                for policy, pattern in self.routes
                if policy.method == scope["method"] and pattern.fullmatch(scope["path"])
            ),
            None,
        )
        try:
            if policy and policy.module != "system":
                client = scope.get("client")
                await self.runtime.limiter.check(policy, client[0] if client else "unknown")
        except ApiError as error:
            logger.info(
                "HTTP response",
                extra={
                    "request_id": request_id,
                    "endpoint_id": policy.id.value if policy else "unregistered",
                    "method": scope["method"],
                    "status": error.status,
                    "duration_ms": round((time.monotonic() - started) * 1000, 2),
                },
            )
            await JSONResponse(
                {"success": False, "message": error.message},
                status_code=error.status,
                headers={"X-Request-ID": request_id},
            )(scope, receive, send)
            return

        async def response_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                logger.info(
                    "HTTP response",
                    extra={
                        "request_id": request_id,
                        "endpoint_id": policy.id.value if policy else "unregistered",
                        "method": scope["method"],
                        "status": message["status"],
                        "duration_ms": round((time.monotonic() - started) * 1000, 2),
                    },
                )
                message["headers"] = list(message.get("headers", [])) + [
                    (b"x-request-id", request_id.encode()),
                    (b"x-content-type-options", b"nosniff"),
                ]
            await send(message)

        received = 0
        limit = (
            self.runtime.settings.upload_max_bytes + 65536
            if policy and policy.id.value == "upload.create"
            else 1048576
        )

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise ApiError(413, "Request body exceeds limit")
            return message

        await self.app(scope, limited_receive, response_send)
