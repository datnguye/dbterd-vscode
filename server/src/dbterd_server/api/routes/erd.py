import asyncio
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from dbterd_server.api.dependencies import get_erd_service
from dbterd_server.api.service import ErdService
from dbterd_server.erd.cache import ErdResult
from dbterd_server.erd.errors import ErdBuildError
from dbterd_server.schemas import ErdPayload, ErdProgress, ErrorResponse

router = APIRouter()

ServiceDep = Annotated[ErdService, Depends(get_erd_service)]

# Sentinel placed in the queue by the build thread when it finishes.
_DONE = object()


def _sse(event: str, model: BaseModel) -> str:
    """Format a single SSE frame for any Pydantic model."""
    return f"event: {event}\ndata: {model.model_dump_json()}\n\n"


def _project_not_allowed(project_path: str) -> ErrorResponse:
    """Return the standard ErrorResponse for a disallowed project path."""
    return ErrorResponse(
        code="project_not_allowed",
        detail=f"Project path not in allow-list: {project_path}",
    )


def _resolve_project(service: ErdService, project: str | None) -> tuple[str, bool]:
    """Return (project_path, is_allowed). is_allowed=False means 403."""
    project_path = project if project is not None else service.default_project_path
    if project is not None and not service.is_allowed(project_path):
        return project_path, False
    return project_path, True


@router.get(
    "/erd",
    response_model=ErdPayload,
    responses={
        400: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        404: {"model": ErrorResponse},
    },
)
async def get_erd(
    response: Response,
    service: ServiceDep,
    project: str | None = None,
) -> ErdPayload:
    project_path, allowed = _resolve_project(service, project)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_project_not_allowed(project_path).model_dump(),
        )
    result = service.build(project_path)
    if result.catalog_missing:
        response.headers["X-Erd-Warnings"] = "catalog-missing"
    return result.payload


async def _sse_generator(
    service: ErdService,
    project_path: str,
) -> AsyncGenerator[str, None]:
    """Yield SSE frames for the streaming build.

    The synchronous (CPU-bound) build runs in a thread pool via asyncio.to_thread.
    Progress callbacks push ErdProgress objects into a queue; the async generator
    drains the queue, yielding SSE frames, until the build thread signals completion.
    The terminal event is either `result` (ErdPayload) or `error` (ErrorResponse).
    """
    loop = asyncio.get_running_loop()
    # Queue holds either ErdProgress events or the _DONE sentinel.
    # Using object as the item type accepts both without a Union that includes
    # the un-typeable sentinel.
    queue: asyncio.Queue[object] = asyncio.Queue()

    def on_progress(progress: ErdProgress) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, progress)

    def run_build() -> ErdResult:
        try:
            return service.build_with_progress(project_path, on_progress)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, _DONE)

    build_task = asyncio.ensure_future(asyncio.to_thread(run_build))

    while True:
        item = await queue.get()
        if item is _DONE:
            break
        # Only ErdProgress objects are put into the queue by on_progress;
        # the sentinel is handled above, so this cast is safe.
        yield _sse("progress", item)  # type: ignore[arg-type]

    try:
        result = await build_task
    except ErdBuildError as err:
        error_body = ErrorResponse(code=err.code, detail=str(err))
        yield _sse("error", error_body)
        return

    yield _sse("result", result.payload)


@router.get("/erd/stream")
async def get_erd_stream(
    service: ServiceDep,
    project: str | None = None,
) -> StreamingResponse:
    project_path, allowed = _resolve_project(service, project)
    if not allowed:
        error_body = _project_not_allowed(project_path)
        # HTTP status can't change mid-stream; for the 403 case we return a
        # plain JSON response before the stream starts.
        return StreamingResponse(
            iter([_sse("error", error_body)]),
            status_code=status.HTTP_403_FORBIDDEN,
            media_type="text/event-stream",
        )
    return StreamingResponse(
        _sse_generator(service, project_path),
        media_type="text/event-stream",
    )
