from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from dbterd_server.api.dependencies import get_erd_service
from dbterd_server.api.service import ErdService
from dbterd_server.schemas import ErdPayload, ErrorResponse

router = APIRouter()

ServiceDep = Annotated[ErdService, Depends(get_erd_service)]


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
    project_path = project if project is not None else service.default_project_path
    if project is not None and not service.is_allowed(project_path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ErrorResponse(
                code="project_not_allowed",
                detail=f"Project path not in allow-list: {project_path}",
            ).model_dump(),
        )
    result = service.build(project_path)
    if result.catalog_missing:
        response.headers["X-Erd-Warnings"] = "catalog-missing"
    return result.payload
