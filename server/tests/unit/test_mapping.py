from pathlib import Path

import pytest

from dbterd_server.erd import mapping


def _ref_dict(parent: str, child: str, parent_cols: list[str], child_cols: list[str], **kw) -> dict:
    return {
        "name": kw.get("name", "r1"),
        "type": kw.get("type", "n1"),
        "table_map": [parent, child],
        "column_map": [parent_cols, child_cols],
        "relationship_label": kw.get("relationship_label"),
    }


@pytest.mark.parametrize(
    ("parent_cols", "child_cols"),
    [(["x", "y"], ["z"]), ([], ["x"]), (["x"], [])],
)
def test_map_ref_returns_none_for_misaligned_or_empty_columns(
    parent_cols: list[str], child_cols: list[str]
) -> None:
    assert mapping.map_ref(_ref_dict("a", "b", parent_cols, child_cols), 0) is None


def test_map_ref_normalizes_unknown_cardinality() -> None:
    edge = mapping.map_ref(_ref_dict("a", "b", ["x"], ["y"], type="weird-value"), 0)
    assert edge is not None
    assert edge.cardinality == ""


def test_map_ref_falls_back_to_ref_prefix_when_name_missing() -> None:
    edge = mapping.map_ref(_ref_dict("a", "b", ["x"], ["y"], name=None), 3)
    assert edge is not None
    assert edge.id == "ref__3"


def test_resolve_raw_sql_path_returns_none_when_path_missing() -> None:
    assert (
        mapping.resolve_raw_sql_path(
            {"resource_type": "model", "original_file_path": None},
            Path("/tmp"),
        )
        is None
    )


def test_resolve_raw_sql_path_returns_none_for_non_model_node() -> None:
    assert (
        mapping.resolve_raw_sql_path(
            {"resource_type": "seed", "original_file_path": "seeds/x.csv"},
            Path("/tmp"),
        )
        is None
    )


def test_resolve_raw_sql_path_returns_none_when_path_not_string() -> None:
    assert (
        mapping.resolve_raw_sql_path(
            {"resource_type": "model", "original_file_path": 123},
            Path("/tmp"),
        )
        is None
    )


def test_resolve_resource_type_falls_back_to_model() -> None:
    # Reach through map_table since _resolve_resource_type is module-private.
    node = mapping.map_table(
        {"name": "x", "resource_type": "unknown", "columns": []},
        Path("/tmp"),
    )
    assert node.resource_type == "model"
