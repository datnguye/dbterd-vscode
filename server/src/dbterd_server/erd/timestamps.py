import logging
from datetime import datetime, timezone
from typing import Any

_logger = logging.getLogger(__name__)


def parse_generated_at(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            # dbt emits trailing 'Z' which Python's fromisoformat handles on 3.11+.
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            _logger.debug("Falling back to now() for unparseable generated_at: %r", value)
    return datetime.now(timezone.utc)
