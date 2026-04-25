"""Public entrypoint module — `from dbterd_server.main import app`.

Kept thin for tooling that imports the FastAPI singleton (uvicorn, tests).
The app itself is constructed in `dbterd_server.api`.
"""

from dbterd_server.api.app import app
from dbterd_server.api.lifespan import lifespan

__all__ = ["app", "lifespan"]
