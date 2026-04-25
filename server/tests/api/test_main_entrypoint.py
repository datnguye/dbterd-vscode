import importlib
import io
import json
import socket
from importlib.metadata import PackageNotFoundError
from typing import Any
from unittest.mock import patch

import pytest

import dbterd_server
from dbterd_server.__main__ import _bind_socket, _build_parser, main
from dbterd_server.api.app import app as fastapi_app
from dbterd_server.api.service import ErdService
from dbterd_server.tools import codegen


def test_bind_socket_returns_listening_socket_on_explicit_port() -> None:
    sock = _bind_socket(0)
    try:
        port = sock.getsockname()[1]
        assert 1024 <= port <= 65535
        # Connecting succeeds, proving the socket is listening.
        with socket.create_connection(("127.0.0.1", port), timeout=1) as _:
            pass
    finally:
        sock.close()


def test_build_parser_defaults() -> None:
    ns = _build_parser().parse_args([])
    assert ns.port == 0
    assert ns.project == ""
    assert ns.allow_project == []
    assert ns.log_level == "info"


def test_build_parser_parses_args() -> None:
    ns = _build_parser().parse_args(
        [
            "--port",
            "8765",
            "--project",
            "/tmp/p",
            "--allow-project",
            "/tmp/q",
            "--allow-project",
            "/tmp/r",
            "--log-level",
            "debug",
        ]
    )
    assert ns.port == 8765
    assert ns.project == "/tmp/p"
    assert ns.allow_project == ["/tmp/q", "/tmp/r"]
    assert ns.log_level == "debug"


def test_main_prints_handshake_after_socket_bind(
    capsys: pytest.CaptureFixture[str],
) -> None:
    captured: dict[str, Any] = {}

    class FakeServer:
        def __init__(self, config: object) -> None:
            captured["config"] = config

        def run(self, sockets: list[socket.socket]) -> None:
            captured["sockets"] = sockets

    argv = ["dbterd-server", "--port", "0", "--project", "/tmp/demo"]
    try:
        with (
            patch("dbterd_server.__main__.uvicorn.Server", FakeServer),
            patch("sys.argv", argv),
        ):
            main()

        out = capsys.readouterr().out
        assert "DBTERD_READY http://127.0.0.1:" in out
        # Server received exactly the bound socket.
        sockets: list[socket.socket] = captured["sockets"]
        assert len(sockets) == 1
        assert sockets[0].getsockname()[0] == "127.0.0.1"
        # Service was wired with the requested project as default.
        assert fastapi_app.state.erd_service.default_project_path == "/tmp/demo"
    finally:
        for s in captured.get("sockets", []):
            s.close()
        # Reset shared singleton state so we don't leak into other tests.
        fastapi_app.state.erd_service = ErdService()


def test_codegen_dumps_json_schema_to_stdout() -> None:
    buf = io.StringIO()
    with patch("sys.stdout", buf):
        codegen.main()
    output = buf.getvalue()
    assert output.endswith("\n")
    schema = json.loads(output)
    assert schema["title"] == "ErdPayload"
    assert set(schema["properties"]) == {"nodes", "edges", "metadata"}


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
