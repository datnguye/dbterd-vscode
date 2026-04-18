import argparse
import socket

import uvicorn

from dbterd_server.main import app


def _pick_port(requested: int) -> int:
    if requested != 0:
        return requested
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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
        help="Absolute path to the dbt project root.",
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
    port = _pick_port(args.port)
    app.state.project_path = args.project

    # Handshake line — the extension reads this to learn the URL.
    print(f"DBTERD_READY http://127.0.0.1:{port}", flush=True)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level=args.log_level)


if __name__ == "__main__":
    main()
