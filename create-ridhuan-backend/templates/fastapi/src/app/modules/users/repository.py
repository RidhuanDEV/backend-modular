from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import User


async def user_by_id(session: AsyncSession, id: UUID, *, lock: bool = False) -> User | None:
    statement = select(User).where(User.id == id, User.deleted_at.is_(None))
    if lock:
        statement = statement.execution_options(populate_existing=True).with_for_update()
    return await session.scalar(statement)


async def user_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(select(User).where(User.email == email))
