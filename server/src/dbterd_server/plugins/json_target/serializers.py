"""Pure dataclass-to-dict converters. Easier to test in isolation than the
adapter class, which has dbterd's BaseTargetAdapter contract baked in."""

from typing import Any

from dbterd.core.models import Column, Ref, Table


def column_to_dict(col: Column) -> dict[str, Any]:
    return {
        "name": col.name,
        "data_type": col.data_type,
        "description": col.description,
        "is_primary_key": bool(col.is_primary_key),
    }


def table_to_dict(table: Table, file_paths: dict[str, str]) -> dict[str, Any]:
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
        "columns": [column_to_dict(c) for c in (table.columns or [])],
    }


def relationship_to_dict(ref: Ref) -> dict[str, Any]:
    parent, child = ref.table_map
    parent_cols, child_cols = ref.column_map
    return {
        "name": ref.name,
        "type": ref.type,
        "table_map": [parent, child],
        "column_map": [list(parent_cols), list(child_cols)],
        "relationship_label": ref.relationship_label,
    }
