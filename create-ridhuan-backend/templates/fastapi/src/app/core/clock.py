from datetime import UTC, datetime
from zoneinfo import ZoneInfo


def now() -> datetime:
    return datetime.now(UTC)


def in_zone(instant: datetime, zone: str) -> datetime:
    if instant.tzinfo is None:
        raise ValueError("An aware instant is required")
    return instant.astimezone(ZoneInfo(zone))
