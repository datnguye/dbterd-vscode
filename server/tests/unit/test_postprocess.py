from dbterd_server.erd import postprocess as pp
from dbterd_server.schemas import Column, ErdEdge, ErdNode


def _node(id_: str, columns: list[Column]) -> ErdNode:
    return ErdNode(
        id=id_,
        name=id_,
        resource_type="model",
        schema_name=None,
        database=None,
        columns=columns,
        raw_sql_path=None,
    )


def _ref(parent: str, child: str, parent_cols: list[str], child_cols: list[str]) -> dict:
    return {
        "name": "r",
        "type": "n1",
        "table_map": [parent, child],
        "column_map": [parent_cols, child_cols],
        "relationship_label": None,
    }


def _edge(from_id: str, to_id: str, from_col: str, to_col: str) -> ErdEdge:
    return ErdEdge(
        id="e",
        from_id=from_id,
        to_id=to_id,
        from_column=from_col,
        to_column=to_col,
        relationship_type="fk",
    )


def test_marks_foreign_key_columns_on_child_side() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    pp.postprocess([node], [], [_ref("parent", "n1", ["pid"], ["id"])])
    assert node.columns[0].is_foreign_key is True


def test_mark_foreign_key_columns_handles_missing_node() -> None:
    pp.postprocess([], [], [_ref("ghost", "ghost", ["x"], ["y"])])


def test_mark_foreign_key_columns_skips_unknown_column_name() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    pp.postprocess([node], [], [_ref("parent", "n1", ["x"], ["missing"])])
    assert node.columns[0].is_foreign_key is False


def test_mark_foreign_key_columns_marks_composite_fks() -> None:
    node = _node(
        "fct",
        [Column(name=c) for c in ("customer_id", "segment_code", "other")],
    )
    pp.postprocess(
        [node],
        [],
        [_ref("dim", "fct", ["customer_id", "segment_code"], ["customer_id", "segment_code"])],
    )
    marked = {c.name for c in node.columns if c.is_foreign_key}
    assert marked == {"customer_id", "segment_code"}


def test_mark_foreign_key_columns_skips_malformed_ref() -> None:
    node = _node("fct", [])
    # Missing table_map / column_map entirely shouldn't explode.
    pp.postprocess([node], [], [{}])
    pp.postprocess([node], [], [{"table_map": ["a"], "column_map": [[]]}])


def test_injects_missing_ref_columns_as_synthetic_fks() -> None:
    parent = _node("parent", [Column(name="id", is_primary_key=True)])
    child = _node("child", [])
    pp.postprocess([parent, child], [_edge("parent", "child", "id", "parent_id")], [])
    injected = next(c for c in child.columns if c.name == "parent_id")
    assert injected.is_foreign_key is True
    assert injected.is_primary_key is False


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
