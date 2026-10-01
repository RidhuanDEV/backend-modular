from urllib.parse import unquote, urlsplit

from redis.asyncio import Redis
from redis.asyncio.retry import Retry
from redis.backoff import NoBackoff

from app.core.settings import Settings


def redis_client(settings: Settings) -> Redis:
    url = urlsplit(settings.redis_url.get_secret_value())
    if url.scheme not in {"redis", "rediss"} or not url.hostname:
        raise ValueError("REDIS_URL must be redis:// or rediss://")
    return Redis(
        host=url.hostname,
        port=url.port or 6379,
        db=int(url.path.lstrip("/") or "0"),
        username=unquote(url.username) if url.username else None,
        password=unquote(url.password) if url.password else None,
        ssl=url.scheme == "rediss",
        decode_responses=True,
        socket_timeout=0.5,
        socket_connect_timeout=0.5,
        max_connections=30,
        # Cache fallback and fail-closed rate limiting must respect the socket
        # deadline; the SDK's default retry backoff can otherwise take seconds.
        retry=Retry(NoBackoff(), 0),
    )


async def execute(redis: Redis, *arguments: str | int) -> str | int:
    # redis-py 7.4.1 execute_command has no return annotation. This is the SDK
    # boundary; callers must narrow the response, never propagate an unknown type.
    result: object = await redis.execute_command(*arguments)  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    if isinstance(result, (str, int)):
        return result
    raise ValueError("Unexpected Redis command response")
