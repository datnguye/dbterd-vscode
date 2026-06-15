"""Post-mapping pass that fixes up the payload before we hand it off.

Two fix-ups, in order:

1. Reconcile edge endpoints to node ids. With `entity-name-format: model`,
   dbterd's json target shortens an edge's `from_id`/`to_id` to the node's
   short `name` while the node's `id` stays fully qualified — so the endpoints
   reference ids that no node has. The webview matches edge `source`/`target`
   against node `id`, so every such edge silently vanishes from the canvas. We
   remap each endpoint back to its canonical node id by short name.

2. Inject edge-referenced columns missing from their node. Partial-catalog
   projects can have edges pointing at columns absent from the node's column
   list; we add synthetic entries so the webview anchors edges to real column
   handles instead of the table border. This relies on step 1 having already
   aligned `from_id`/`to_id` with real node ids.

The pass uses a node index with a memoized column-name set so wide tables with
high edge fan-in stay O(edges) instead of O(edges × columns).
"""

from dbterd_server.schemas import Column, ErdEdge, ErdNode


class _NodeIndex:
    """Node-by-id, by-name, plus a memoized column-name set per node.

    The column-name set turns the "does this column already exist?" check from
    a linear scan into an O(1) membership test, and stays in sync as
    `add_column` appends. The by-name map lets us reconcile short-name edge
    endpoints back to canonical node ids.
    """

    def __init__(self, nodes: list[ErdNode]) -> None:
        self._by_id = {node.id: node for node in nodes}
        # Last node wins on a name collision; node ids are unique so the
        # id-keyed lookups above are always exact. Name is only a fallback.
        self._id_by_name = {node.name: node.id for node in nodes}
        self._column_names = {node.id: {col.name for col in node.columns} for node in nodes}

    def get(self, node_id: str | None) -> ErdNode | None:
        return self._by_id.get(node_id) if node_id is not None else None

    def resolve_id(self, endpoint: str) -> str:
        """Map an edge endpoint to a real node id.

        Returns `endpoint` unchanged if it already names a node id; otherwise
        the id of the node whose short `name` matches; otherwise `endpoint`
        untouched (an endpoint we can't reconcile is left for the column-
        injection guard to skip, never silently rewritten to something wrong).
        """
        if endpoint in self._by_id:
            return endpoint
        return self._id_by_name.get(endpoint, endpoint)

    def has_column(self, node: ErdNode, column_name: str) -> bool:
        return column_name in self._column_names[node.id]

    def add_column(self, node: ErdNode, column: Column) -> None:
        node.columns.append(column)
        self._column_names[node.id].add(column.name)


def postprocess(nodes: list[ErdNode], edges: list[ErdEdge]) -> None:
    """Reconcile edge endpoints to node ids, then inject missing columns."""
    index = _NodeIndex(nodes)
    reconcile_edge_endpoints(edges, index)
    ensure_ref_columns_exist(edges, index)


def reconcile_edge_endpoints(edges: list[ErdEdge], index: _NodeIndex) -> None:
    for edge in edges:
        edge.from_id = index.resolve_id(edge.from_id)
        edge.to_id = index.resolve_id(edge.to_id)


def ensure_ref_columns_exist(edges: list[ErdEdge], index: _NodeIndex) -> None:
    for edge in edges:
        _inject_column(index, index.get(edge.from_id), edge.from_column)
        _inject_column(index, index.get(edge.to_id), edge.to_column)


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
