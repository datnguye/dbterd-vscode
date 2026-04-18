import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dbterd_server.main import app as fastapi_app


@pytest.fixture
def app() -> FastAPI:
    fastapi_app.state.project_path = ""
    return fastapi_app


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)
