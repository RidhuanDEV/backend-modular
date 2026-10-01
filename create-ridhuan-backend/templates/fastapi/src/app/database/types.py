from uuid import UUID

from sqlalchemy import CHAR
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator, TypeEngine


class Guid(TypeDecorator[UUID]):
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect: Dialect) -> TypeEngine[UUID] | TypeEngine[str]:
        return (
            dialect.type_descriptor(PGUUID(as_uuid=True))
            if dialect.name == "postgresql"
            else dialect.type_descriptor(CHAR(36, collation="utf8mb4_bin"))
        )

    def process_bind_param(self, value: UUID | None, dialect: Dialect) -> UUID | str | None:
        if value is None:
            return None
        return value if dialect.name == "postgresql" else str(value)

    def process_result_value(self, value: UUID | str | None, dialect: Dialect) -> UUID | None:
        return UUID(value) if isinstance(value, str) else value
