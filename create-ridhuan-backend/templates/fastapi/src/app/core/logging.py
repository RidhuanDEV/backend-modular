import json
import logging

from app.core.clock import now


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # Do not serialize arbitrary LogRecord extra fields or exception messages from drivers.
        payload: dict[str, str | int | float] = {
            "time": now().isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in (
            "request_id",
            "endpoint_id",
            "method",
            "status",
            "duration_ms",
            "notification_id",
            "error_type",
        ):
            value: object = getattr(record, key, None)
            if isinstance(value, (str, int, float)):
                payload[key] = value
        return json.dumps(payload)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
