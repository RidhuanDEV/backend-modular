from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.api.registry import EndpointId, Policy
from app.core.blocking import BlockingPool
from app.core.settings import Settings
from app.platform.cache.service import Cache
from app.platform.rate_limit.service import Limiter
from app.platform.storage.service import Storage


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    policies: dict[EndpointId, Policy]
    limiter: Limiter
    cache: Cache
    storage: Storage
    work: BlockingPool
