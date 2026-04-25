from typing import Annotated

from fastapi import APIRouter, Depends

from dbterd_server import __version__
from dbterd_server.api.dependencies import get_erd_service
from dbterd_server.api.service import ErdService
from dbterd_server.schemas import HealthStatus

router = APIRouter()

ServiceDep = Annotated[ErdService, Depends(get_erd_service)]


@router.get("/healthz", response_model=HealthStatus)
async def healthz(service: ServiceDep) -> HealthStatus:
    return HealthStatus(
        status="ok",
        version=__version__,
        project_path_configured=bool(service.default_project_path),
    )
