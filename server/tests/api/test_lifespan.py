from fastapi import FastAPI
from fastapi.testclient import TestClient

from dbterd_server.api.lifespan import lifespan
from dbterd_server.api.service import ErdService


def test_initializes_missing_erd_service() -> None:
    fresh = FastAPI(lifespan=lifespan)
    with TestClient(fresh) as client:
        assert isinstance(fresh.state.erd_service, ErdService)
        assert client.get("/").status_code == 404


def test_preserves_existing_erd_service() -> None:
    pre_existing = ErdService(default_project_path="/already/set")
    fresh = FastAPI(lifespan=lifespan)
    fresh.state.erd_service = pre_existing
    with TestClient(fresh):
        assert fresh.state.erd_service is pre_existing
    assert fresh.state.erd_service is pre_existing
