import importlib
import io
import json
import socket
from importlib.metadata import PackageNotFoundError
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import dbterd_server
from dbterd_server import codegen
from dbterd_server.__main__ import _build_parser, _pick_port, main
from dbterd_server.main import app as fastapi_app
from dbterd_server.main import lifespan


def test_pick_port_returns_requested_when_nonzero() -> None:
    assert _pick_port(12345) == 12345


def test_pick_port_auto_picks_free_port_when_zero() -> None:
    port = _pick_port(0)
    assert 1024 <= port <= 65535
    # Port should be re-bindable — prove it's a real free port.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", port))


def test_build_parser_defaults() -> None:
    parser = _build_parser()
    ns = parser.parse_args([])
    assert ns.port == 0
    assert ns.project == ""
    assert ns.log_level == "info"


def test_build_parser_parses_args() -> None:
    ns = _build_parser().parse_args(
        ["--port", "8765", "--project", "/tmp/p", "--log-level", "debug"]
    )
    assert ns.port == 8765
    assert ns.project == "/tmp/p"
    assert ns.log_level == "debug"


def test_main_prints_handshake_and_runs_uvicorn(
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: dict[str, object] = {}

    def fake_run(app: object, **kwargs: object) -> None:
        calls["app"] = app
        calls["kwargs"] = kwargs

    argv = ["dbterd-server", "--port", "9999", "--project", "/tmp/demo"]
    try:
        with (
            patch("dbterd_server.__main__.uvicorn.run", side_effect=fake_run),
            patch("sys.argv", argv),
        ):
            main()

        out = capsys.readouterr().out
        assert "DBTERD_READY http://127.0.0.1:9999" in out
        assert calls["app"] is fastapi_app
        assert calls["kwargs"] == {"host": "127.0.0.1", "port": 9999, "log_level": "info"}
        assert fastapi_app.state.project_path == "/tmp/demo"
    finally:
        fastapi_app.state.project_path = ""


def test_lifespan_initializes_missing_project_path() -> None:
    fresh = FastAPI(lifespan=lifespan)
    with TestClient(fresh) as client:
        assert fresh.state.project_path == ""
        assert client.get("/").status_code == 404


def test_lifespan_preserves_existing_project_path() -> None:
    fresh = FastAPI(lifespan=lifespan)
    fresh.state.project_path = "/already/set"
    with TestClient(fresh):
        assert fresh.state.project_path == "/already/set"
    assert fresh.state.project_path == "/already/set"


def test_codegen_dumps_json_schema_to_stdout() -> None:
    buf = io.StringIO()
    with patch("sys.stdout", buf):
        codegen.main()
    output = buf.getvalue()
    assert output.endswith("\n")
    schema = json.loads(output)
    assert schema["title"] == "ErdPayload"
    assert set(schema["properties"]) == {"nodes", "edges", "generated_at", "dbt_project_name"}


def test_version_is_resolved_from_package_metadata() -> None:
    assert dbterd_server.__version__
    assert dbterd_server.__version__ != "0.0.0+unknown"


def test_version_falls_back_when_package_metadata_missing() -> None:
    with patch("importlib.metadata.version", side_effect=PackageNotFoundError):
        reloaded = importlib.reload(dbterd_server)
    try:
        assert reloaded.__version__ == "0.0.0+unknown"
    finally:
        importlib.reload(dbterd_server)
