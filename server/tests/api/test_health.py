from fastapi.testclient import TestClient

from dbterd_server import __version__
from dbterd_server.api.app import create_app
from dbterd_server.api.service import ErdService


def test_healthz_reports_status_ok(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__
    assert body["project_path_configured"] is False


def test_healthz_reports_project_configured() -> None:
    service = ErdService(default_project_path="/some/project")
    app = create_app(service=service)
    with TestClient(app) as client:
        body = client.get("/healthz").json()
    assert body["project_path_configured"] is True
