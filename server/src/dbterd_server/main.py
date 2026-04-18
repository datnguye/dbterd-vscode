from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from dbterd_server.schemas import ErdPayload, HealthStatus


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # __main__ sets project_path before uvicorn starts; direct imports (tests,
    # embeddings) may not — guarantee the attribute exists for /erd.
    if not hasattr(app.state, "project_path"):
        app.state.project_path = ""
    yield


app = FastAPI(title="dbterd-server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(vscode-webview://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET"],
    allow_headers=["Content-Type"],
)


@app.get("/healthz", response_model=HealthStatus)
async def healthz() -> HealthStatus:
    return HealthStatus(status="ok")


@app.get("/erd", response_model=ErdPayload)
async def get_erd(request: Request) -> ErdPayload:
    project_path: str = getattr(request.app.state, "project_path", "")
    if not project_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No dbt project path configured.",
        )
    return ErdPayload(
        nodes=[],
        edges=[],
        generated_at=datetime.now(timezone.utc),
        dbt_project_name="",
    )
