"""FastAPI app factory.

The server is intended to be reachable only on 127.0.0.1; CORS is locked to
vscode-webview:// and localhost. Don't expose this on a public interface.
"""

from fastapi import FastAPI

from dbterd_server.api.errors import register_error_handlers
from dbterd_server.api.lifespan import lifespan
from dbterd_server.api.middleware import register_middleware
from dbterd_server.api.routes import register_routes
from dbterd_server.api.service import ErdService


def create_app(service: ErdService | None = None) -> FastAPI:
    app = FastAPI(title="dbterd-server", lifespan=lifespan)
    if service is not None:
        app.state.erd_service = service
    register_middleware(app)
    register_error_handlers(app)
    register_routes(app)
    return app


# Module-level app for `uvicorn dbterd_server.main:app` and tests that import
# the singleton — __main__ assigns the service before uvicorn starts serving.
app = create_app()
