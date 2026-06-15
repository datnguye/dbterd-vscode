import pytest

from dbterd_server.erd import mapping


def _node_dict(**kw) -> dict:  # type: ignore[type-arg]
    base = {
        "id": "model.proj.orders",
        "name": "model.proj.orders",
        "label": None,
        "description": None,
        "resource_type": "model",
        "schema_name": "public",
        "database": "prod",
        "columns": [],
        "compiled_sql": None,
    }
    base.update(kw)
    return base


def _edge_dict(**kw) -> dict:  # type: ignore[type-arg]
    base = {
        "id": "fk__1",
        "from_id": "model.proj.order_items",
        "to_id": "model.proj.orders",
        "from_columns": ["order_id"],
        "to_columns": ["order_id"],
        "relationship_type": "fk",
        "name": "fk_order_items_to_orders",
        "label": None,
        "cardinality": "n1",
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# map_node
# ---------------------------------------------------------------------------


def test_map_node_maps_all_fields() -> None:
    node = mapping.map_node(
        _node_dict(
            id="model.proj.orders",
            name="model.proj.orders",
            label="Orders",
            description="All orders",
            resource_type="model",
            schema_name="public",
            database="prod",
            compiled_sql="select 1",
            columns=[
                {
                    "name": "order_id",
                    "data_type": "bigint",
                    "description": "PK",
                    "is_primary_key": True,
                    "is_foreign_key": False,
                }
            ],
        )
    )
    assert node.id == "model.proj.orders"
    assert node.name == "model.proj.orders"
    assert node.label == "Orders"
    assert node.description == "All orders"
    assert node.resource_type == "model"
    assert node.schema_name == "public"
    assert node.database == "prod"
    assert node.compiled_sql == "select 1"
    assert len(node.columns) == 1
    col = node.columns[0]
    assert col.name == "order_id"
    assert col.data_type == "bigint"
    assert col.description == "PK"
    assert col.is_primary_key is True
    assert col.is_foreign_key is False


def test_map_node_empty_columns_list() -> None:
    node = mapping.map_node(_node_dict(columns=[]))
    assert node.columns == []


def test_map_node_none_columns_treated_as_empty() -> None:
    node = mapping.map_node(_node_dict(columns=None))
    assert node.columns == []


def test_map_node_empty_string_optional_fields_become_none() -> None:
    node = mapping.map_node(_node_dict(label="", description="", compiled_sql=""))
    assert node.label is None
    assert node.description is None
    assert node.compiled_sql is None


def test_map_node_fk_flag_passthrough() -> None:
    node = mapping.map_node(
        _node_dict(
            columns=[
                {"name": "order_id", "is_primary_key": False, "is_foreign_key": True},
            ]
        )
    )
    assert node.columns[0].is_foreign_key is True


@pytest.mark.parametrize(
    "resource_type",
    ["model", "source", "seed", "snapshot"],
)
def test_map_node_known_resource_types_pass_through(resource_type: str) -> None:
    node = mapping.map_node(_node_dict(resource_type=resource_type))
    assert node.resource_type == resource_type


@pytest.mark.parametrize(
    "bad_type",
    ["unknown", None, "", "exposure", "metric"],
)
def test_map_node_unknown_resource_type_coerces_to_model(bad_type: object) -> None:
    node = mapping.map_node(_node_dict(resource_type=bad_type))
    assert node.resource_type == "model"


# ---------------------------------------------------------------------------
# map_edge
# ---------------------------------------------------------------------------


def test_map_edge_maps_all_fields() -> None:
    edge = mapping.map_edge(_edge_dict())
    assert edge is not None
    assert edge.id == "fk__1"
    assert edge.from_id == "model.proj.order_items"
    assert edge.to_id == "model.proj.orders"
    assert edge.from_column == "order_id"
    assert edge.to_column == "order_id"
    assert edge.from_columns == ["order_id"]
    assert edge.to_columns == ["order_id"]
    assert edge.relationship_type == "fk"
    assert edge.name == "fk_order_items_to_orders"
    assert edge.cardinality == "n1"


def test_map_edge_derives_primary_column_pair_from_arrays() -> None:
    edge = mapping.map_edge(
        _edge_dict(
            from_columns=["customer_id", "segment_code"],
            to_columns=["id", "seg"],
        )
    )
    assert edge is not None
    assert edge.from_column == "customer_id"
    assert edge.to_column == "id"
    assert edge.from_columns == ["customer_id", "segment_code"]
    assert edge.to_columns == ["id", "seg"]


@pytest.mark.parametrize(
    ("from_cols", "to_cols"),
    [
        ([], ["order_id"]),
        (["order_id"], []),
        ([], []),
    ],
)
def test_map_edge_returns_none_for_empty_columns(from_cols: list[str], to_cols: list[str]) -> None:
    assert mapping.map_edge(_edge_dict(from_columns=from_cols, to_columns=to_cols)) is None


def test_map_edge_returns_none_for_misaligned_columns() -> None:
    assert mapping.map_edge(_edge_dict(from_columns=["a", "b"], to_columns=["x"])) is None


def test_map_edge_normalizes_unknown_cardinality() -> None:
    edge = mapping.map_edge(_edge_dict(cardinality="weird-value"))
    assert edge is not None
    assert edge.cardinality == ""


@pytest.mark.parametrize("relationship_type", ["fk", "lineage"])
def test_map_edge_known_relationship_types_pass_through(relationship_type: str) -> None:
    edge = mapping.map_edge(_edge_dict(relationship_type=relationship_type))
    assert edge is not None
    assert edge.relationship_type == relationship_type


@pytest.mark.parametrize("bad_type", ["belongs_to", None, "", "many_to_many"])
def test_map_edge_unknown_relationship_type_coerces_to_fk(bad_type: object) -> None:
    edge = mapping.map_edge(_edge_dict(relationship_type=bad_type))
    assert edge is not None
    assert edge.relationship_type == "fk"


def test_map_edge_label_none_when_empty_string() -> None:
    edge = mapping.map_edge(_edge_dict(label=""))
    assert edge is not None
    assert edge.label is None


def test_map_edge_name_none_when_empty_string() -> None:
    edge = mapping.map_edge(_edge_dict(name=""))
    assert edge is not None
    assert edge.name is None
