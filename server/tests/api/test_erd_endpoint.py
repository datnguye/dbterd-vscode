import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from dbterd_server.api.app import create_app
from dbterd_server.api.service import ErdService


def _client_for(project_path: str, allowed: frozenset[str] | None = None) -> TestClient:
    service = ErdService(default_project_path=project_path, allowed_project_paths=allowed)
    return TestClient(create_app(service=service))


def test_happy_path(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    response = client.get("/erd")
    assert response.status_code == 200
    assert "X-Erd-Warnings" not in response.headers
    body = response.json()
    assert len(body["nodes"]) > 0
    assert body["metadata"]["dbt_project_name"]


def test_emits_catalog_warning(fixture_project: Path) -> None:
    (fixture_project / "target" / "catalog.json").unlink()
    client = _client_for(str(fixture_project))
    response = client.get("/erd")
    assert response.status_code == 200
    assert response.headers.get("X-Erd-Warnings") == "catalog-missing"


def test_returns_404_with_structured_body_on_missing_manifest(fixture_project: Path) -> None:
    (fixture_project / "target" / "manifest.json").unlink()
    client = _client_for(str(fixture_project))
    response = client.get("/erd")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "manifest_missing"
    assert "manifest.json" in body["detail"]


def test_returns_400_without_project_path(client: TestClient) -> None:
    response = client.get("/erd")
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "project_path_missing"


def test_returns_400_with_invalid_project_path(tmp_path: Path) -> None:
    client = _client_for(str(tmp_path / "nope"))
    response = client.get("/erd")
    assert response.status_code == 400
    assert response.json()["code"] == "project_path_invalid"


def test_returns_400_with_invalid_config(fixture_project: Path) -> None:
    (fixture_project / ".dbterd.yml").write_text(": : not yaml :")
    client = _client_for(str(fixture_project))
    response = client.get("/erd")
    assert response.status_code == 400
    assert response.json()["code"] == "config_invalid"


def test_query_param_project_must_be_in_allow_list(fixture_project: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    other.mkdir()
    client = _client_for(str(fixture_project))
    response = client.get(f"/erd?project={other}")
    assert response.status_code == 403
    body = response.json()
    assert body["detail"]["code"] == "project_not_allowed"


def test_query_param_project_in_allow_list_is_used(fixture_project: Path, tmp_path: Path) -> None:
    # Allow-list a second copy of the fixture; default points to the first.
    other = tmp_path / "other"
    shutil.copytree(fixture_project, other)
    client = _client_for(str(fixture_project), allowed=frozenset({str(other)}))
    response = client.get(f"/erd?project={other}")
    assert response.status_code == 200


def test_request_id_header_is_returned(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    response = client.get("/erd")
    assert response.headers.get("X-Request-ID")


def test_request_id_header_is_propagated(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    response = client.get("/erd", headers={"X-Request-ID": "test-id-123"})
    assert response.headers["X-Request-ID"] == "test-id-123"
