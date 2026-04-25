"""Cross-cutting middleware. Server is localhost-only — no auth layer here."""

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

_logger = logging.getLogger("dbterd_server.access")
_REQUEST_ID_HEADER = "X-Request-ID"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Tag each request with an X-Request-ID and log one structured line."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        request_id = request.headers.get(_REQUEST_ID_HEADER) or uuid.uuid4().hex
        request.state.request_id = request_id
        start = time.perf_counter()
        response: Response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers[_REQUEST_ID_HEADER] = request_id
        _logger.info(
            "request_id=%s method=%s path=%s status=%d elapsed_ms=%.2f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response


def register_middleware(app: FastAPI) -> None:
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(vscode-webview://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Erd-Warnings", _REQUEST_ID_HEADER],
    )
