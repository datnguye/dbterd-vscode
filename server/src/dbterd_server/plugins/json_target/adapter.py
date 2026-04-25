"""Lossless JSON target adapter for dbterd. Intended for upstream contribution
to dbterd; lives here as a local plugin until merged."""

import json
from typing import ClassVar

from dbterd.core.adapters.target import BaseTargetAdapter
from dbterd.core.models import Ref, Table
from dbterd.core.registry.decorators import register_target

from dbterd_server.plugins.json_target.manifest import (
    extract_metadata,
    index_original_file_paths,
)
from dbterd_server.plugins.json_target.serializers import (
    relationship_to_dict,
    table_to_dict,
)


@register_target("json", description="Lossless JSON representation of tables and relationships")
class JsonAdapter(BaseTargetAdapter):
    """Emit tables + relationships as structured JSON."""

    file_extension = ".json"
    default_filename = "output.json"

    RELATIONSHIP_SYMBOLS: ClassVar[dict[str, str]] = {}
    DEFAULT_SYMBOL = ""

    def build_erd(self, tables: list[Table], relationships: list[Ref], **kwargs) -> str:
        manifest = kwargs.get("manifest")
        file_paths = index_original_file_paths(manifest)
        metadata = extract_metadata(manifest)
        payload = {
            "metadata": metadata,
            "tables": [table_to_dict(t, file_paths) for t in tables],
            "relationships": [relationship_to_dict(r) for r in relationships],
        }
        return json.dumps(payload)

    def format_table(self, table: Table, **kwargs) -> str:
        file_paths: dict[str, str] = kwargs.get("file_paths") or {}
        return json.dumps(table_to_dict(table, file_paths))

    def format_relationship(self, relationship: Ref, **kwargs) -> str:
        return json.dumps(relationship_to_dict(relationship))
