import logging

from pydantic import BaseModel, ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.platform.cache.models import CacheGeneration

logger = logging.getLogger(__name__)


class Cache:
    def __init__(self, settings: Settings, redis: Redis) -> None:
        self.settings = settings
        self.redis = redis

    async def key(self, session: AsyncSession, suffix: str) -> str:
        version = await session.scalar(
            select(CacheGeneration.version).where(CacheGeneration.id == 1)
        )
        return f"{self.settings.redis_namespace}:cache:{version or 0}:{suffix}"

    async def get[T: BaseModel](self, key: str, model: type[T]) -> T | None:
        if not self.settings.cache_enabled:
            return None
        try:
            value: object = await self.redis.get(key)
            return model.model_validate_json(value) if isinstance(value, str) else None
        except (RedisError, TimeoutError, ValidationError):
            logger.warning("Optional cache read unavailable")
            return None

    async def set(self, key: str, model: BaseModel) -> None:
        if not self.settings.cache_enabled:
            return
        try:
            await self.redis.set(key, model.model_dump_json(by_alias=True), ex=60)
        except (RedisError, TimeoutError):
            logger.warning("Optional cache write unavailable")


async def invalidate(session: AsyncSession) -> None:
    await session.execute(
        update(CacheGeneration)
        .where(CacheGeneration.id == 1)
        .values(version=CacheGeneration.version + 1)
    )
