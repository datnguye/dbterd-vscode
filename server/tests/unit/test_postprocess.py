from dbterd_server.erd import postprocess as pp
from dbterd_server.schemas import Column, ErdEdge, ErdNode


def _node(id_: str, columns: list[Column], name: str | None = None) -> ErdNode:
    return ErdNode(
        id=id_,
        name=name if name is not None else id_,
        resource_type="model",
        schema_name=None,
        database=None,
        columns=columns,
    )


def _edge(from_id: str, to_id: str, from_col: str, to_col: str) -> ErdEdge:
    return ErdEdge(
        id="e",
        from_id=from_id,
        to_id=to_id,
        from_column=from_col,
        to_column=to_col,
        relationship_type="fk",
    )


def test_injects_missing_from_column_as_synthetic_fk() -> None:
    parent = _node("parent", [])
    child = _node("child", [Column(name="id", is_primary_key=True)])
    pp.postprocess([parent, child], [_edge("parent", "child", "parent_fk", "id")])
    injected = next(c for c in parent.columns if c.name == "parent_fk")
    assert injected.is_foreign_key is True
    assert injected.is_primary_key is False
    assert injected.data_type is None


def test_injects_missing_to_column_as_synthetic_fk() -> None:
    parent = _node("parent", [Column(name="id", is_primary_key=True)])
    child = _node("child", [])
    pp.postprocess([parent, child], [_edge("parent", "child", "id", "parent_id")])
    injected = next(c for c in child.columns if c.name == "parent_id")
    assert injected.is_foreign_key is True
    assert injected.is_primary_key is False


def test_does_not_inject_duplicate_columns() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    pp.postprocess([node], [_edge("n1", "n1", "id", "id")])
    assert len(node.columns) == 1
    assert node.columns[0].is_primary_key is True


def test_postprocess_no_op_on_empty_inputs() -> None:
    pp.postprocess([], [])


def test_postprocess_skips_when_edge_references_unknown_node() -> None:
    node = _node("known", [])
    pp.postprocess([node], [_edge("ghost", "known", "x", "y")])
    # "ghost" node is unknown — should not raise; "known" gets "y" injected
    assert any(c.name == "y" for c in node.columns)


def test_inject_column_is_noop_when_node_missing() -> None:
    index = pp._NodeIndex([])
    pp._inject_column(index, None, "foo")


def test_inject_column_is_noop_when_column_name_empty() -> None:
    node = _node("n1", [])
    index = pp._NodeIndex([node])
    pp._inject_column(index, node, None)
    assert node.columns == []


def test_inject_column_does_not_duplicate() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    index = pp._NodeIndex([node])
    pp._inject_column(index, node, "id")
    assert len(node.columns) == 1
    assert node.columns[0].is_primary_key is True


def test_ensure_ref_columns_exist_injects_both_sides() -> None:
    from_node = _node("from", [])
    to_node = _node("to", [])
    index = pp._NodeIndex([from_node, to_node])
    edge = _edge("from", "to", "fk_col", "pk_col")
    pp.ensure_ref_columns_exist([edge], index)
    assert any(c.name == "fk_col" for c in from_node.columns)
    assert any(c.name == "pk_col" for c in to_node.columns)


# ---------------------------------------------------------------------------
# edge-endpoint reconciliation (entity-name-format: model)
# ---------------------------------------------------------------------------


def test_reconciles_short_name_endpoints_to_node_ids() -> None:
    # Mirrors dbterd's `entity-name-format: model` quirk: edges reference the
    # short name while node ids stay fully qualified.
    orders = _node("model.proj.orders", [], name="orders")
    locations = _node("model.proj.locations", [], name="locations")
    edge = _edge("orders", "locations", "location_id", "location_id")
    pp.postprocess([orders, locations], [edge])
    assert edge.from_id == "model.proj.orders"
    assert edge.to_id == "model.proj.locations"


def test_reconciliation_leaves_already_canonical_ids_untouched() -> None:
    parent = _node("model.proj.parent", [], name="parent")
    child = _node("model.proj.child", [], name="child")
    edge = _edge("model.proj.parent", "model.proj.child", "id", "parent_id")
    pp.postprocess([parent, child], [edge])
    assert edge.from_id == "model.proj.parent"
    assert edge.to_id == "model.proj.child"


def test_reconciliation_leaves_unresolvable_endpoint_untouched() -> None:
    known = _node("model.proj.known", [], name="known")
    edge = _edge("ghost", "known", "x", "y")
    pp.postprocess([known], [edge])
    # "ghost" matches neither an id nor a name — left as-is, never guessed.
    assert edge.from_id == "ghost"
    assert edge.to_id == "model.proj.known"


def test_reconciliation_enables_column_injection_on_resolved_node() -> None:
    # The whole point: after remapping, the short-name endpoint resolves to a
    # real node, so the missing FK column gets injected onto it.
    orders = _node("model.proj.orders", [], name="orders")
    edge = _edge("orders", "orders", "location_id", "location_id")
    pp.postprocess([orders], [edge])
    assert edge.from_id == "model.proj.orders"
    assert any(c.name == "location_id" and c.is_foreign_key for c in orders.columns)


def test_node_index_resolve_id_prefers_id_over_name() -> None:
    # A pathological payload where one node's id equals another's name: the
    # exact id match must win so we never misroute an edge.
    a = _node("alpha", [], name="beta")
    b = _node("gamma", [], name="alpha")
    index = pp._NodeIndex([a, b])
    assert index.resolve_id("alpha") == "alpha"
