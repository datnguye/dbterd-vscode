import shutil
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dbterd_server.api.app import create_app
from dbterd_server.api.service import ErdService
from dbterd_server.erd.cache import ErdCache

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "jaffle_shop"


@pytest.fixture
def cache() -> ErdCache:
    return ErdCache()


@pytest.fixture
def service(cache: ErdCache) -> ErdService:
    return ErdService(cache=cache)


@pytest.fixture
def app(service: ErdService) -> FastAPI:
    return create_app(service=service)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


@pytest.fixture
def fixture_project(tmp_path: Path) -> Path:
    dest = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, dest)
    return dest
