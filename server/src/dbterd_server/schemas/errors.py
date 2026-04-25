from typing import Literal

from pydantic import BaseModel

ErrorCode = Literal[
    "manifest_missing",
    "project_path_missing",
    "project_path_invalid",
    "project_not_allowed",
    "config_invalid",
]


class ErrorResponse(BaseModel):
    code: ErrorCode
    detail: str
