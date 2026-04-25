"""Pure functions that translate dbterd's JSON-target dicts into our schema."""

import logging
from pathlib import Path
from typing import Any

from dbterd_server.erd.cardinality import normalize as normalize_cardinality
from dbterd_server.schemas import Column, ErdEdge, ErdNode, ResourceType

_logger = logging.getLogger(__name__)

_RESOURCE_TYPES: list[ResourceType] = ["model", "source", "seed", "snapshot"]


def map_table(table: dict[str, Any], project_path: Path) -> ErdNode:
    columns = [
        Column(
            name=col["name"],
            data_type=col.get("data_type"),
            description=col.get("description") or None,
            is_primary_key=bool(col.get("is_primary_key", False)),
            is_foreign_key=False,  # set later by post-processing
        )
        for col in (table.get("columns") or [])
    ]
    # Use table["name"] as the id, not node_name. The JSON target uses
    # table.name (which reflects entity_name_format) as the key, and edges
    # reference it — using node_name here would desync the graph whenever the
    # user sets entity-name-format != "resource.package.model".
    return ErdNode(
        id=table["name"],
        name=table["name"],
        resource_type=_resolve_resource_type(table.get("resource_type")),
        schema_name=table.get("schema") or None,
        database=table.get("database") or None,
        columns=columns,
        raw_sql_path=resolve_raw_sql_path(table, project_path),
    )


def _resolve_resource_type(raw: Any) -> ResourceType:
    return raw if raw in _RESOURCE_TYPES else "model"


def resolve_raw_sql_path(table: dict[str, Any], project_path: Path) -> str | None:
    # Only models have compiled SQL we care about. original_file_path comes
    # straight from the manifest via our JSON target; verify it resolves on
    # disk because a broken link is worse than no link.
    if table.get("resource_type") != "model":
        return None
    relative = table.get("original_file_path")
    if not isinstance(relative, str) or not relative:
        return None
    candidate = (project_path / relative).resolve()
    return str(candidate) if candidate.is_file() else None


def map_ref(ref: dict[str, Any], index: int) -> ErdEdge | None:
    parent, child = ref["table_map"]
    parent_cols, child_cols = ref["column_map"]
    if not parent_cols or not child_cols:
        return None
    if len(parent_cols) != len(child_cols):
        # A misaligned ref can't be paired safely — the "primary" pair at
        # index 0 would silently associate unrelated columns. Drop the whole
        # edge and log so the user can investigate the underlying manifest.
        _logger.warning(
            "Skipping ref %s: parent_cols (%d) and child_cols (%d) differ in length",
            ref.get("name"),
            len(parent_cols),
            len(child_cols),
        )
        return None
    return ErdEdge(
        id=f"{ref.get('name') or 'ref'}__{index}",
        from_id=parent,
        to_id=child,
        from_column=parent_cols[0],
        to_column=child_cols[0],
        from_columns=list(parent_cols),
        to_columns=list(child_cols),
        relationship_type="fk",
        name=ref.get("name") or None,
        label=ref.get("relationship_label") or None,
        cardinality=normalize_cardinality(ref.get("type", ""), ref.get("name")),
    )
