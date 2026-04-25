"""Map domain `ErdBuildError`s to structured HTTP responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from dbterd_server.erd.errors import ErdBuildError
from dbterd_server.schemas import ErrorResponse


async def _erd_build_error_handler(_: Request, err: Exception) -> JSONResponse:
    # Each ErdBuildError subclass carries its own code + http_status — no
    # string-sniffing of error messages.
    err = err if isinstance(err, ErdBuildError) else ErdBuildError(str(err))
    body = ErrorResponse(code=err.code, detail=str(err))
    return JSONResponse(status_code=err.http_status, content=body.model_dump())


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ErdBuildError, _erd_build_error_handler)
