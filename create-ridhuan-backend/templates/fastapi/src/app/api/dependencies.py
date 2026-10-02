from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.routing import APIRoute

from app.api.registry import EndpointId
from app.core.context import Context
from app.core.errors import ApiError
from app.core.runtime import Runtime
from app.core.security import verify_access
from app.modules.users.repository import user_by_id


def runtime(request: Request) -> Runtime:
    value: object = request.app.state.runtime
    if not isinstance(value, Runtime):
        raise RuntimeError("Runtime has not started")
    return value


async def context(
    request: Request, run: Annotated[Runtime, Depends(runtime)]
) -> AsyncIterator[Context]:
    route: object = request.scope.get("route")
    if not isinstance(route, APIRoute) or route.operation_id is None:
        raise RuntimeError("Unregistered HTTP action")
    policy = run.policies[EndpointId(route.operation_id)]
    async with run.sessions() as session:
        actor = None
        expiry = None
        if policy.authenticated:
            header = request.headers.get("authorization", "")
            if not header.startswith("Bearer "):
                raise ApiError(401, "Authentication required")
            claims = verify_access(header[7:], run.settings)
            actor = await user_by_id(session, claims.sub)
            expiry = claims.exp
            request.scope["state"] = {**request.scope.get("state", {}), "token_expiry": expiry}
            if actor is None:
                raise ApiError(401, "User unavailable")
            if policy.permission and policy.permission not in {
                grant.permission.name for grant in actor.role.grants
            }:
                raise ApiError(403, "Forbidden")
        try:
            yield Context(
                session, policy, actor, request.headers.get("x-request-id", ""), run.work, expiry
            )
        finally:
            await session.rollback()


RequestContext = Annotated[Context, Depends(context, scope="function")]
AppRuntime = Annotated[Runtime, Depends(runtime)]
