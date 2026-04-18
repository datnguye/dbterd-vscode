from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_erd_requires_project(client: TestClient, app: FastAPI) -> None:
    app.state.project_path = ""
    response = client.get("/erd")
    assert response.status_code == 400
    assert response.json()["detail"] == "No dbt project path configured."


def test_erd_with_project(client: TestClient, app: FastAPI) -> None:
    app.state.project_path = "/tmp/fake-project"
    response = client.get("/erd")
    assert response.status_code == 200
    body = response.json()
    assert body["nodes"] == []
    assert body["edges"] == []
    assert "generated_at" in body
