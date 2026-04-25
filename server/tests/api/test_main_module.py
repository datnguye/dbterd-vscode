"""Smoke test the legacy `dbterd_server.main` re-export.

Kept for `uvicorn dbterd_server.main:app` (Taskfile dev target) and the
extension's bundled server-src copy.
"""

from fastapi import FastAPI

from dbterd_server import main


def test_main_module_re_exports_app() -> None:
    assert isinstance(main.app, FastAPI)
    assert callable(main.lifespan)
