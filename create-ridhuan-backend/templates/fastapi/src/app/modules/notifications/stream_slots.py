import asyncio
from collections import Counter
from collections.abc import Callable
from uuid import UUID

from app.core.errors import ApiError

# Each open stream polls the database; cap them so one account cannot exhaust the pool.
MAX_STREAMS_PER_USER = 4
MAX_STREAMS_TOTAL = 64
# Streams never outlive 14 minutes, so a slot whose body never ran is reclaimed by then.
SLOT_LIFETIME_SECONDS = 14 * 60 + 30

_streams: Counter[UUID] = Counter()


def acquire(user: UUID) -> Callable[[], None]:
    """Reserve a stream slot before headers are sent; the returned release is idempotent."""
    if (
        sum(_streams.values()) >= MAX_STREAMS_TOTAL
        or _streams[user] >= MAX_STREAMS_PER_USER
    ):
        raise ApiError(429, "Too many open notification streams")
    _streams[user] += 1
    released = False

    def release() -> None:
        nonlocal released
        if released:
            return
        released = True
        _streams[user] -= 1
        if _streams[user] <= 0:
            del _streams[user]

    asyncio.get_running_loop().call_later(SLOT_LIFETIME_SECONDS, release)
    return release
