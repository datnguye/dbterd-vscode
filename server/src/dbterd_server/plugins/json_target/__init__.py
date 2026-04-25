"""Lossless JSON target adapter for dbterd.

Importing this subpackage triggers the @register_target side effect that wires
the "json" target into dbterd's PluginRegistry, so DbtErd(target="json") works.
"""

from dbterd_server.plugins.json_target.adapter import JsonAdapter

__all__ = ["JsonAdapter"]
