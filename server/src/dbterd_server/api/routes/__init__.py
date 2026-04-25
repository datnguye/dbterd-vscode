from fastapi import FastAPI

from dbterd_server.api.routes import erd, health


def register_routes(app: FastAPI) -> None:
    app.include_router(health.router)
    app.include_router(erd.router)
