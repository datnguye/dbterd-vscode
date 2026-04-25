from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from dbterd_server.api.service import ErdService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # __main__ may have set erd_service before uvicorn starts; direct imports
    # (tests) usually have not — guarantee the service exists for routes.
    if not hasattr(app.state, "erd_service"):
        app.state.erd_service = ErdService()
    yield
