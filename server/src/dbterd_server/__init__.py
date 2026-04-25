"""dbterd FastAPI server."""

from importlib.metadata import PackageNotFoundError, version

# Import for its @register_target side effect — registers the "json" target
# with dbterd's PluginRegistry so DbtErd(target="json") resolves it.
from dbterd_server.plugins import json_target as _json_target  # noqa: F401

try:
    __version__ = version("dbterd-server")
except PackageNotFoundError:
    __version__ = "0.0.0+unknown"
