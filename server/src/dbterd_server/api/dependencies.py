"""FastAPI Depends helpers — pull the ErdService off app.state."""

from fastapi import Request

from dbterd_server.api.service import ErdService


def get_erd_service(request: Request) -> ErdService:
    return request.app.state.erd_service
