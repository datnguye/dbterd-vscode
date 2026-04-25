"""File-based logging for dbterd-server.

Routes the root logger and uvicorn loggers to a rotating file under
``~/.dbterd/`` so support sessions have a persistent transcript of every
request, error, and warning. The path is printed on stdout at startup so the
extension can surface a "Show Logs" link to the user.
"""

import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR_ENV = "DBTERD_LOG_DIR"
LOG_FILE_PREFIX = "dbterd-server-"
LOG_FILE_SUFFIX = ".log"
MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5


def resolve_log_dir() -> Path:
    override = os.environ.get(LOG_DIR_ENV)
    if override:
        return Path(override)
    return Path.home() / ".dbterd"


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def build_log_path(log_dir: Path | None = None) -> Path:
    target = log_dir if log_dir is not None else resolve_log_dir()
    target.mkdir(parents=True, exist_ok=True)
    return target / f"{LOG_FILE_PREFIX}{_timestamp()}{LOG_FILE_SUFFIX}"


# dbterd's helpers/log.py sets ``propagate = False`` on its "dbterd" logger and
# attaches a stderr StreamHandler — meaning records emitted by the dbterd CLI /
# API never bubble up to the root logger. The file handler therefore has to be
# registered directly on "dbterd" in addition to root. Every other logger we
# care about (uvicorn.*, dbterd_server.*) propagates to root, so attaching the
# handler to root alone is enough — attaching it to ancestors *and* descendants
# would write each record twice.
_DIRECT_HANDLER_LOGGERS = (
    "",  # root — catches uvicorn.* and dbterd_server.* via propagation
    "dbterd",  # propagate=False, so we must attach directly
)
# Loggers we still want to set a level on, even though their records reach the
# file handler via propagation. Without this they'd inherit WARNING from root
# and silently drop INFO/DEBUG output.
_LEVEL_ONLY_LOGGERS = (
    "uvicorn",
    "uvicorn.error",
    "uvicorn.access",
    "dbterd_server",
)


def configure_file_logging(level: str, log_path: Path) -> RotatingFileHandler:
    """Attach a RotatingFileHandler to root + the dbterd CLI logger.

    ``level`` follows uvicorn's vocabulary (critical/error/warning/info/debug/
    trace). "trace" and other non-stdlib values fall back to INFO. The level is
    applied to the *loggers*, not the handler — the handler stays at NOTSET so
    DEBUG records from dbterd reach the file when --log-level=debug is set.
    """
    # delay=True opens the file lazily on first emit so a process that exits
    # before logging anything (e.g. immediate startup crash, orphaned spawn)
    # doesn't leave a 0-byte log file behind.
    handler = RotatingFileHandler(
        log_path,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
        delay=True,
    )
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s %(name)s %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )

    numeric = getattr(logging, level.upper(), logging.INFO)
    effective_level = numeric if isinstance(numeric, int) else logging.INFO

    for name in _DIRECT_HANDLER_LOGGERS:
        logger = logging.getLogger(name)
        logger.addHandler(handler)
        logger.setLevel(effective_level)

    for name in _LEVEL_ONLY_LOGGERS:
        logging.getLogger(name).setLevel(effective_level)

    return handler
