from dbterd_server.erd import postprocess
from dbterd_server.schemas import Column, ErdNode


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


def test_mark_foreign_key_columns_handles_missing_node() -> None:
    postprocess.mark_foreign_key_columns([], [_ref("ghost", "ghost", ["x"], ["y"])])


def test_mark_foreign_key_columns_skips_unknown_column_name() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    postprocess.mark_foreign_key_columns([node], [_ref("parent", "n1", ["x"], ["missing"])])
    assert node.columns[0].is_foreign_key is False


def test_mark_foreign_key_columns_marks_composite_fks() -> None:
    node = _node(
        "fct",
        [Column(name=c) for c in ("customer_id", "segment_code", "other")],
    )
    postprocess.mark_foreign_key_columns(
        [node],
        [_ref("dim", "fct", ["customer_id", "segment_code"], ["customer_id", "segment_code"])],
    )
    marked = {c.name for c in node.columns if c.is_foreign_key}
    assert marked == {"customer_id", "segment_code"}


def test_mark_foreign_key_columns_skips_malformed_ref() -> None:
    node = _node("fct", [])
    # Missing table_map / column_map entirely shouldn't explode.
    postprocess.mark_foreign_key_columns([node], [{}])
    postprocess.mark_foreign_key_columns([node], [{"table_map": ["a"], "column_map": [[]]}])


def test_inject_column_is_noop_when_node_missing() -> None:
    postprocess._inject_column(None, "foo")


def test_inject_column_is_noop_when_column_name_empty() -> None:
    node = _node("n1", [])
    postprocess._inject_column(node, None)
    assert node.columns == []


def test_inject_column_does_not_duplicate() -> None:
    node = _node("n1", [Column(name="id", data_type="bigint", is_primary_key=True)])
    postprocess._inject_column(node, "id")
    assert len(node.columns) == 1
    assert node.columns[0].is_primary_key is True
