"""Post-mapping passes that fix up nodes/edges before we hand the payload off.

dbterd's catalog-sourced columns never get is_foreign_key=True even when they're
on the child side of a ref, and partial-catalog projects can have edges pointing
at columns that don't exist on the node. Both gaps are patched here.
"""

from typing import Any

from dbterd_server.schemas import Column, ErdEdge, ErdNode


def ensure_ref_columns_exist(nodes: list[ErdNode], edges: list[ErdEdge]) -> None:
    index = {node.id: node for node in nodes}
    for edge in edges:
        _inject_column(index.get(edge.from_id), edge.from_column)
        _inject_column(index.get(edge.to_id), edge.to_column)


def mark_foreign_key_columns(nodes: list[ErdNode], refs: list[dict[str, Any]]) -> None:
    # Mark only the child side of each ref — the columns that hold the
    # reference. Parent columns (typically PKs) stay as-is so they keep the
    # PK badge. Iterates the full column_map so composite FKs cover every
    # participating column, not just the first.
    index = {node.id: node for node in nodes}
    for ref in refs:
        table_map = ref.get("table_map") or [None, None]
        column_map = ref.get("column_map") or [[], []]
        if len(table_map) < 2 or len(column_map) < 2:
            continue
        child_id = table_map[1]
        child_cols = column_map[1] or []
        node = index.get(child_id)
        if node is None:
            continue
        child_col_set = set(child_cols)
        for col in node.columns:
            if col.name in child_col_set:
                col.is_foreign_key = True


def _inject_column(node: ErdNode | None, column_name: str | None) -> None:
    if node is None or not column_name:
        return
    if any(col.name == column_name for col in node.columns):
        return
    node.columns.append(
        Column(
            name=column_name,
            data_type=None,
            description=None,
            is_primary_key=False,
            is_foreign_key=True,
        )
    )
