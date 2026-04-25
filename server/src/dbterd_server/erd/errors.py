from dbterd_server.schemas import ErrorCode


class ErdBuildError(Exception):
    """Raised when the ERD cannot be built — the server maps this to HTTP 4xx."""

    code: ErrorCode = "config_invalid"
    http_status: int = 400


class ManifestMissingError(ErdBuildError):
    """target/manifest.json is absent. The user probably hasn't run `dbt compile`."""

    code: ErrorCode = "manifest_missing"
    http_status: int = 404


class ProjectPathMissingError(ErdBuildError):
    """The server has no project path configured. The user needs to set one."""

    code: ErrorCode = "project_path_missing"
    http_status: int = 400


class ProjectPathInvalidError(ErdBuildError):
    """The configured project path doesn't exist on disk."""

    code: ErrorCode = "project_path_invalid"
    http_status: int = 400


class ConfigInvalidError(ErdBuildError):
    """`.dbterd.yml` / `[tool.dbterd]` failed to parse or validate."""

    code: ErrorCode = "config_invalid"
    http_status: int = 400
