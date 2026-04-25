import argparse
import socket

import uvicorn

from dbterd_server.api.app import app
from dbterd_server.api.service import ErdService
from dbterd_server.erd.cache import ErdCache


def _bind_socket(requested_port: int) -> socket.socket:
    """Bind a listening socket on 127.0.0.1 *before* uvicorn starts serving.

    Closes the handshake race the extension was hitting: the printed URL is
    only emitted after the socket actually accepts connections, so the
    extension never sees a "connection refused" window.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", requested_port))
    sock.listen(128)
    return sock


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dbterd-server")
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Port to bind (0 = auto-pick an ephemeral port).",
    )
    parser.add_argument(
        "--project",
        type=str,
        default="",
        help="Absolute path to the default dbt project root.",
    )
    parser.add_argument(
        "--allow-project",
        action="append",
        default=[],
        help="Additional project paths permitted via /erd?project=. Repeatable.",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="info",
        choices=["critical", "error", "warning", "info", "debug", "trace"],
    )
    return parser


def main() -> None:
    args = _build_parser().parse_args()
    sock = _bind_socket(args.port)
    bound_port = sock.getsockname()[1]

    service = ErdService(
        default_project_path=args.project,
        allowed_project_paths=frozenset(args.allow_project),
        cache=ErdCache(),
    )
    app.state.erd_service = service

    # Handshake line — the extension reads this to learn the URL.
    # Now safe: socket is bound and listening before this prints.
    print(f"DBTERD_READY http://127.0.0.1:{bound_port}", flush=True)

    config = uvicorn.Config(app, host="127.0.0.1", port=bound_port, log_level=args.log_level)
    server = uvicorn.Server(config)
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
