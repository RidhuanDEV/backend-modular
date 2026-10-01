from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.registry import Policy
from app.api.schemas import DTO, snapshot
from app.core.blocking import BlockingPool
from app.modules.users.models import User
from app.platform.audit.service import record
from app.platform.cache.service import invalidate


@dataclass(frozen=True)
class Context:
    session: AsyncSession
    policy: Policy
    actor: User | None
    request_id: str
    work: BlockingPool
    token_expiry: int | None = None

    def require_actor(self) -> User:
        if self.actor is None:
            raise RuntimeError("Authenticated context required")
        return self.actor

    async def commit(
        self,
        entity: UUID | None,
        before: DTO | None = None,
        after: DTO | None = None,
        *,
        invalidate_cache: bool = True,
        actor: UUID | None = None,
    ) -> None:
        await record(
            self.session,
            self.policy,
            actor or (self.actor.id if self.actor else None),
            entity,
            self.request_id,
            before=snapshot(before) if before else None,
            after=snapshot(after) if after else None,
        )
        if invalidate_cache:
            await invalidate(self.session)
        await self.session.commit()
