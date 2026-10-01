from sqlalchemy import BigInteger
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class CacheGeneration(Base):
    __tablename__ = "cache_generation"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(BigInteger, default=0)
