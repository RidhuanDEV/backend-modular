import asyncio
import hashlib
import logging
import time
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.api.registry import Policy, RateGroup
from app.core.errors import ApiError
from app.core.settings import Settings
from app.platform.redis import execute

logger = logging.getLogger(__name__)
_LUA = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return tostring(n)"


@dataclass
class Bucket:
    count: int
    expires: float


class Limiter:
    def __init__(self, settings: Settings, redis: Redis) -> None:
        self.settings = settings
        self.redis = redis
        self.buckets: dict[str, Bucket] = {}
        self.lock = asyncio.Lock()
        self.quotas: dict[RateGroup, tuple[int, int]] = {
            "auth": (settings.rate_limit_auth_max, settings.rate_limit_auth_window_ms),
            "public": (settings.rate_limit_public_max, settings.rate_limit_public_window_ms),
            "internal": (settings.rate_limit_internal_max, settings.rate_limit_internal_window_ms),
        }

    async def check(self, policy: Policy, ip: str) -> None:
        maximum, window_ms = self.quotas[policy.rate]
        key = f"{self.settings.redis_namespace}:rate:{policy.id}:{hashlib.sha256(ip.encode()).hexdigest()}"
        if self.settings.rate_limit_store == "redis":
            try:
                value = await execute(self.redis, "EVAL", _LUA, 1, key, window_ms)
                if not isinstance(value, str) or not value.isdecimal():
                    raise ApiError(503, "Rate limiter unavailable")
                count = int(value)
            except (RedisError, TimeoutError) as error:
                if policy.rate == "auth":
                    raise ApiError(503, "Rate limiter unavailable") from error
                logger.warning(
                    "Rate limiter Redis unavailable", extra={"endpoint_id": policy.id.value}
                )
                return
        else:
            async with self.lock:
                instant = time.monotonic()
                bucket = self.buckets.get(key)
                if bucket is None or bucket.expires <= instant:
                    # Bound memory even under random IP traffic. Expired entries are removed first.
                    if len(self.buckets) >= 10000:
                        self.buckets = {
                            k: v for k, v in self.buckets.items() if v.expires > instant
                        }
                        if len(self.buckets) >= 10000:
                            raise ApiError(503, "Rate limiter capacity reached")
                    bucket = Bucket(0, instant + window_ms / 1000)
                    self.buckets[key] = bucket
                bucket.count += 1
                count = bucket.count
        if count > maximum:
            raise ApiError(429, "Too many requests")
