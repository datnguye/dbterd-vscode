"""Post-mapping pass that fixes up the payload before we hand it off.

Three fix-ups, in order:

1. Reconcile edge endpoints to node ids. With `entity-name-format: model`,
   dbterd's json target shortens an edge's `from_id`/`to_id` to the node's
   short `name` while the node's `id` stays fully qualified — so the endpoints
   reference ids that no node has. The webview matches edge `source`/`target`
   against node `id`, so every such edge silently vanishes from the canvas. We
   remap each endpoint back to its canonical node id by short name.

2. Inject edge-referenced columns missing from their node. Partial-catalog
   projects can have edges pointing at columns absent from the node's column
   list; we add synthetic entries so the webview anchors edges to real column
   handles instead of the table border. Every column an edge references is
   injected — the full composite `from_columns`/`to_columns` lists, not just the
   primary pair — so step 3's FK flag can land on each drawn connector. This
   relies on step 1 having already aligned `from_id`/`to_id` with real node ids.

3. Flag FK-holder columns. dbterd's json target draws relationship edges but
   does not always set `is_foreign_key` on the columns those edges originate
   from (its column flagging and its edge detection can diverge — observed on
   relationship-test-derived edges, where every `from_column` participates in an
   edge yet stays `is_foreign_key=False`). We mark every column on the `from_id`
   side of an edge as a foreign key so the webview's FK badge matches the
   connectors actually drawn. This relies on steps 1–2: endpoints are real node
   ids and the referenced columns exist.

The pass uses a node index with a memoized column-name set so wide tables with
high edge fan-in stay O(edges) instead of O(edges × columns).
"""

from dbterd_server.schemas import Column, ErdEdge, ErdNode


class _NodeIndex:
    """Node-by-id, by-name, plus a memoized column-by-name map per node.

    The column-by-name map turns both the "does this column already exist?"
    check and the "fetch this column" lookup from a linear scan into an O(1)
    operation, and stays in sync as `add_column` appends. The by-name map lets
    us reconcile short-name edge endpoints back to canonical node ids.
    """

    def __init__(self, nodes: list[ErdNode]) -> None:
        self._by_id = {node.id: node for node in nodes}
        # Last node wins on a name collision; node ids are unique so the
        # id-keyed lookups above are always exact. Name is only a fallback.
        self._id_by_name = {node.name: node.id for node in nodes}
        self._columns_by_name = {
            node.id: {col.name: col for col in reversed(node.columns)} for node in nodes
        }

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
        return column_name in self._columns_by_name[node.id]

    def get_column(self, node: ErdNode, column_name: str) -> Column | None:
        return self._columns_by_name[node.id].get(column_name)

    def add_column(self, node: ErdNode, column: Column) -> None:
        node.columns.append(column)
        self._columns_by_name[node.id].setdefault(column.name, column)


def postprocess(nodes: list[ErdNode], edges: list[ErdEdge]) -> None:
    """Reconcile endpoints, inject missing columns, then flag FK columns."""
    index = _NodeIndex(nodes)
    reconcile_edge_endpoints(edges, index)
    ensure_ref_columns_exist(edges, index)
    flag_foreign_key_columns(edges, index)


def reconcile_edge_endpoints(edges: list[ErdEdge], index: _NodeIndex) -> None:
    for edge in edges:
        edge.from_id = index.resolve_id(edge.from_id)
        edge.to_id = index.resolve_id(edge.to_id)


def ensure_ref_columns_exist(edges: list[ErdEdge], index: _NodeIndex) -> None:
    for edge in edges:
        from_node = index.get(edge.from_id)
        to_node = index.get(edge.to_id)
        for column_name in _edge_columns(edge.from_columns, edge.from_column):
            _inject_column(index, from_node, column_name)
        for column_name in _edge_columns(edge.to_columns, edge.to_column):
            _inject_column(index, to_node, column_name)


def flag_foreign_key_columns(edges: list[ErdEdge], index: _NodeIndex) -> None:
    """Mark each edge's `from_id`-side columns as foreign keys.

    The FK holder is the `from` side (dbterd convention: from = referencing /
    child, to = referenced / parent), so only those columns are flagged — never
    the referenced parent columns. Uses the composite `from_columns` list when
    present, else the single `from_column`. Only ever sets the flag True.
    """
    for edge in edges:
        node = index.get(edge.from_id)
        if node is None:
            continue
        for column_name in _edge_columns(edge.from_columns, edge.from_column):
            column = index.get_column(node, column_name)
            if column is not None:
                column.is_foreign_key = True


def _edge_columns(composite: list[str], primary: str | None) -> list[str]:
    """The columns an edge references on one side: the composite list when
    present, else the single primary column (empty when neither is set)."""
    return composite or ([primary] if primary else [])


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
            is_foreign_key=False,
        ),
    )
