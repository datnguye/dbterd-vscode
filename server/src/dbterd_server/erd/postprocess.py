"""Post-mapping passes that fix up nodes/edges before we hand the payload off.

dbterd's catalog-sourced columns never get is_foreign_key=True even when they're
on the child side of a ref, and partial-catalog projects can have edges pointing
at columns that don't exist on the node. Both gaps are patched here.

The two passes share a single node index and per-node column-name set so wide
tables with high edge fan-in stay O(edges) instead of O(edges × columns).
"""

from typing import Any

from dbterd_server.schemas import Column, ErdEdge, ErdNode


class _NodeIndex:
    """Node-by-id plus a memoized column-name set per node.

    Built once and shared by both passes. The column-name set turns the
    "does this column already exist?" check from a linear scan into an O(1)
    membership test, and stays in sync as `_inject_column` appends.
    """

    def __init__(self, nodes: list[ErdNode]) -> None:
        self._by_id = {node.id: node for node in nodes}
        self._column_names = {node.id: {col.name for col in node.columns} for node in nodes}

    def get(self, node_id: str | None) -> ErdNode | None:
        return self._by_id.get(node_id) if node_id is not None else None

    def has_column(self, node: ErdNode, column_name: str) -> bool:
        return column_name in self._column_names[node.id]

    def add_column(self, node: ErdNode, column: Column) -> None:
        node.columns.append(column)
        self._column_names[node.id].add(column.name)


def postprocess(nodes: list[ErdNode], edges: list[ErdEdge], refs: list[dict[str, Any]]) -> None:
    """Run both fix-up passes over a single shared node index."""
    index = _NodeIndex(nodes)
    ensure_ref_columns_exist(edges, index)
    mark_foreign_key_columns(refs, index)


def ensure_ref_columns_exist(edges: list[ErdEdge], index: _NodeIndex) -> None:
    for edge in edges:
        _inject_column(index, index.get(edge.from_id), edge.from_column)
        _inject_column(index, index.get(edge.to_id), edge.to_column)


def mark_foreign_key_columns(refs: list[dict[str, Any]], index: _NodeIndex) -> None:
    # Mark only the child side of each ref — the columns that hold the
    # reference. Parent columns (typically PKs) stay as-is so they keep the
    # PK badge. Iterates the full column_map so composite FKs cover every
    # participating column, not just the first.
    for ref in refs:
        table_map = ref.get("table_map") or [None, None]
        column_map = ref.get("column_map") or [[], []]
        if len(table_map) < 2 or len(column_map) < 2:
            continue
        node = index.get(table_map[1])
        if node is None:
            continue
        child_col_set = set(column_map[1] or [])
        for col in node.columns:
            if col.name in child_col_set:
                col.is_foreign_key = True


def _inject_column(index: _NodeIndex, node: ErdNode | None, column_name: str | None) -> None:
    if node is None or not column_name:
        return
    if index.has_column(node, column_name):
        return
    index.add_column(
        node,
        Column(
            name=column_name,
            data_type=None,
            description=None,
            is_primary_key=False,
            is_foreign_key=True,
        ),
    )
