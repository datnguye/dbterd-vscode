"""Lossless JSON target adapter for dbterd.

Emits tables and relationships as structured JSON so downstream tooling can
consume dbterd's parsed models without reaching into internals. Intended for
upstream contribution to dbterd; lives here as a local plugin until merged.
"""

import json
from typing import Any, ClassVar

from dbterd.core.adapters.target import BaseTargetAdapter
from dbterd.core.models import Column, Ref, Table
from dbterd.core.registry.decorators import register_target


@register_target("json", description="Lossless JSON representation of tables and relationships")
class JsonAdapter(BaseTargetAdapter):
    """Emit tables + relationships as structured JSON."""

    file_extension = ".json"
    default_filename = "output.json"

    RELATIONSHIP_SYMBOLS: ClassVar[dict[str, str]] = {}
    DEFAULT_SYMBOL = ""

    def build_erd(self, tables: list[Table], relationships: list[Ref], **kwargs) -> str:
        manifest = kwargs.get("manifest")
        file_paths = _index_original_file_paths(manifest)
        metadata = _extract_metadata(manifest)
        payload = {
            "metadata": metadata,
            "tables": [self._table_to_dict(t, file_paths) for t in tables],
            "relationships": [self._relationship_to_dict(r) for r in relationships],
        }
        return json.dumps(payload)

    def format_table(self, table: Table, **kwargs) -> str:
        file_paths: dict[str, str] = kwargs.get("file_paths") or {}
        return json.dumps(self._table_to_dict(table, file_paths))

    def format_relationship(self, relationship: Ref, **kwargs) -> str:
        return json.dumps(self._relationship_to_dict(relationship))

    def _table_to_dict(self, table: Table, file_paths: dict[str, str]) -> dict[str, Any]:
        return {
            "name": table.name,
            "database": table.database,
            "schema": table.schema,
            "resource_type": table.resource_type,
            "node_name": table.node_name,
            "original_file_path": file_paths.get(table.node_name or ""),
            "raw_sql": table.raw_sql,
            "description": table.description,
            "label": table.label,
            "exposures": list(table.exposures or []),
            "columns": [_column_to_dict(c) for c in (table.columns or [])],
        }

    def _relationship_to_dict(self, ref: Ref) -> dict[str, Any]:
        parent, child = ref.table_map
        parent_cols, child_cols = ref.column_map
        return {
            "name": ref.name,
            "type": ref.type,
            "table_map": [parent, child],
            "column_map": [list(parent_cols), list(child_cols)],
            "relationship_label": ref.relationship_label,
        }


def _column_to_dict(col: Column) -> dict[str, Any]:
    return {
        "name": col.name,
        "data_type": col.data_type,
        "description": col.description,
        "is_primary_key": bool(col.is_primary_key),
    }


def _index_original_file_paths(manifest: Any) -> dict[str, str]:
    if manifest is None:
        return {}
    nodes = getattr(manifest, "nodes", None) or {}
    index: dict[str, str] = {}
    for unique_id, node in nodes.items():
        path = getattr(node, "original_file_path", None)
        if isinstance(path, str) and path:
            index[unique_id] = path
    return index


def _extract_metadata(manifest: Any) -> dict[str, Any]:
    md = getattr(manifest, "metadata", None)
    if md is None:
        return {"generated_at": "", "project_name": ""}
    return {
        "generated_at": str(getattr(md, "generated_at", "") or ""),
        "project_name": str(getattr(md, "project_name", "") or ""),
    }
