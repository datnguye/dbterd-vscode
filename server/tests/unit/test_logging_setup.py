import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest

from dbterd_server.logging_setup import (
    BACKUP_COUNT,
    LOG_DIR_ENV,
    LOG_FILE_PREFIX,
    MAX_BYTES,
    build_log_path,
    configure_file_logging,
    resolve_log_dir,
)

_MANAGED_LOGGERS = (
    "",
    "uvicorn",
    "uvicorn.error",
    "uvicorn.access",
    "dbterd_server",
    "dbterd_server.access",
    "dbterd",
)


@pytest.fixture(autouse=True)
def _reset_loggers() -> None:
    saved = {name: logging.getLogger(name).level for name in _MANAGED_LOGGERS}
    yield
    for name in _MANAGED_LOGGERS:
        logger = logging.getLogger(name)
        for h in list(logger.handlers):
            if isinstance(h, RotatingFileHandler):
                h.close()
                logger.removeHandler(h)
        logger.setLevel(saved[name])


def test_resolve_log_dir_honours_env_override(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv(LOG_DIR_ENV, str(tmp_path / "custom"))
    assert resolve_log_dir() == tmp_path / "custom"


def test_resolve_log_dir_defaults_to_home_dbterd(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.delenv(LOG_DIR_ENV, raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    assert resolve_log_dir() == tmp_path / ".dbterd"


def test_build_log_path_creates_dir_and_filename(tmp_path: Path) -> None:
    log_dir = tmp_path / "logs"
    path = build_log_path(log_dir)
    assert log_dir.is_dir()
    assert path.parent == log_dir
    assert path.name.startswith(LOG_FILE_PREFIX)
    assert path.suffix == ".log"


def test_configure_file_logging_writes_records(tmp_path: Path) -> None:
    log_path = build_log_path(tmp_path)
    handler = configure_file_logging("info", log_path)
    try:
        assert isinstance(handler, RotatingFileHandler)
        assert handler.maxBytes == MAX_BYTES
        assert handler.backupCount == BACKUP_COUNT
        logging.getLogger("dbterd_server").error("hello world")
        handler.flush()
        contents = log_path.read_text(encoding="utf-8")
        assert "hello world" in contents
        assert "ERROR" in contents
    finally:
        handler.close()


def test_configure_file_logging_captures_dbterd_cli_logger(tmp_path: Path) -> None:
    # Real dbterd ships a logger with propagate=False and its own StreamHandler,
    # so records bypass the root logger. The file handler must be attached
    # directly to the "dbterd" logger to capture CLI/API output.
    dbterd_logger = logging.getLogger("dbterd")
    dbterd_logger.propagate = False  # mimic dbterd.helpers.log

    log_path = build_log_path(tmp_path)
    handler = configure_file_logging("info", log_path)
    try:
        dbterd_logger.warning("manifest parse warning")
        handler.flush()
        contents = log_path.read_text(encoding="utf-8")
        assert "manifest parse warning" in contents
        assert "dbterd" in contents
    finally:
        handler.close()


def test_configure_file_logging_does_not_create_file_until_first_emit(tmp_path: Path) -> None:
    # delay=True means the file is opened lazily on first emit. Sessions that
    # exit before logging anything should not leave a 0-byte file behind.
    log_path = build_log_path(tmp_path)
    # build_log_path does not create the log file itself, only the directory.
    assert not log_path.exists()
    handler = configure_file_logging("info", log_path)
    try:
        assert not log_path.exists()
        logging.getLogger("dbterd_server").info("first record")
        handler.flush()
        assert log_path.exists()
    finally:
        handler.close()


def test_configure_file_logging_unknown_level_falls_back_to_info(tmp_path: Path) -> None:
    log_path = build_log_path(tmp_path)
    handler = configure_file_logging("trace", log_path)
    try:
        # uvicorn's "trace" is not a stdlib level; we should fall back to INFO
        # on the logger (the handler itself stays at NOTSET so loggers control
        # filtering).
        assert logging.getLogger().level == logging.INFO
        assert logging.getLogger("dbterd").level == logging.INFO
    finally:
        handler.close()


def test_configure_file_logging_does_not_duplicate_records(tmp_path: Path) -> None:
    # Records from a descendant logger (e.g. dbterd_server.access) propagate to
    # root. If the handler were attached to both the descendant and root, every
    # record would be written twice. Regression test for the duplicated-line
    # bug seen in real log files.
    log_path = build_log_path(tmp_path)
    handler = configure_file_logging("info", log_path)
    try:
        logging.getLogger("dbterd_server.access").info("request handled")
        handler.flush()
        contents = log_path.read_text(encoding="utf-8")
        assert contents.count("request handled") == 1
    finally:
        handler.close()


def test_configure_file_logging_debug_captures_dbterd_debug_records(tmp_path: Path) -> None:
    # dbterd emits most diagnostic output at DEBUG. With --log-level=debug the
    # file should contain those records, not just WARNING+.
    dbterd_logger = logging.getLogger("dbterd")
    dbterd_logger.propagate = False  # mimic dbterd.helpers.log

    log_path = build_log_path(tmp_path)
    handler = configure_file_logging("debug", log_path)
    try:
        dbterd_logger.debug("parsed manifest in 12ms")
        handler.flush()
        contents = log_path.read_text(encoding="utf-8")
        assert "parsed manifest in 12ms" in contents
    finally:
        handler.close()
