import json
from types import SimpleNamespace

from dbterd.core.models import Column, Ref, Table

import dbterd_server  # noqa: F401 — register the json target
from dbterd_server.plugins.json_target import JsonAdapter
from dbterd_server.plugins.json_target.manifest import (
    extract_metadata,
    index_original_file_paths,
)


def _sample_table() -> Table:
    return Table(
        name="orders",
        database="db",
        schema="sch",
        columns=[Column(name="id", data_type="bigint", description="", is_primary_key=True)],
        raw_sql="select 1",
        resource_type="model",
        node_name="model.pkg.orders",
        description="Orders fact",
        label=None,
    )


def _sample_ref() -> Ref:
    return Ref(
        name="fk_orders_customers",
        table_map=("customers", "orders"),
        column_map=(["id"], ["customer_id"]),
        type="n1",
        relationship_label="orders_customers",
    )


def test_build_erd_emits_expected_top_level_keys() -> None:
    out = JsonAdapter().build_erd([_sample_table()], [_sample_ref()])
    payload = json.loads(out)
    assert set(payload.keys()) == {"metadata", "tables", "relationships"}
    assert payload["metadata"] == {"generated_at": "", "project_name": ""}
    assert payload["tables"][0]["name"] == "orders"
    assert payload["relationships"][0]["name"] == "fk_orders_customers"


def test_build_erd_populates_metadata_from_manifest() -> None:
    manifest = SimpleNamespace(
        metadata=SimpleNamespace(generated_at="2026-01-02T03:04:05Z", project_name="jaffle"),
        nodes={"model.pkg.orders": SimpleNamespace(original_file_path="models/orders.sql")},
    )
    out = JsonAdapter().build_erd([_sample_table()], [], manifest=manifest)
    payload = json.loads(out)
    assert payload["metadata"] == {
        "generated_at": "2026-01-02T03:04:05Z",
        "project_name": "jaffle",
    }
    assert payload["tables"][0]["original_file_path"] == "models/orders.sql"


def test_format_table_round_trips_without_file_paths_kwarg() -> None:
    # format_table is an abstract method on BaseTargetAdapter; exercise the
    # default-empty-dict branch when no file_paths kwarg is passed.
    out = JsonAdapter().format_table(_sample_table())
    parsed = json.loads(out)
    assert parsed["name"] == "orders"
    assert parsed["original_file_path"] is None


def test_format_table_uses_provided_file_paths() -> None:
    out = JsonAdapter().format_table(
        _sample_table(), file_paths={"model.pkg.orders": "models/orders.sql"}
    )
    assert json.loads(out)["original_file_path"] == "models/orders.sql"


def test_format_relationship_round_trips() -> None:
    out = JsonAdapter().format_relationship(_sample_ref())
    parsed = json.loads(out)
    assert parsed["table_map"] == ["customers", "orders"]
    assert parsed["column_map"] == [["id"], ["customer_id"]]


def testindex_original_file_paths_handles_none_manifest() -> None:
    assert index_original_file_paths(None) == {}


def testindex_original_file_paths_handles_nodes_none() -> None:
    # Some dbterd code paths build a manifest shim where .nodes may be None.
    manifest = SimpleNamespace(nodes=None)
    assert index_original_file_paths(manifest) == {}


def testindex_original_file_paths_skips_non_string_paths() -> None:
    manifest = SimpleNamespace(
        nodes={
            "model.a.b": SimpleNamespace(original_file_path="models/b.sql"),
            "model.a.c": SimpleNamespace(original_file_path=None),
            "model.a.d": SimpleNamespace(original_file_path=""),
            "model.a.e": SimpleNamespace(),  # attribute absent entirely
        }
    )
    assert index_original_file_paths(manifest) == {"model.a.b": "models/b.sql"}


def testextract_metadata_handles_none_manifest() -> None:
    assert extract_metadata(None) == {"generated_at": "", "project_name": ""}


def testextract_metadata_handles_missing_metadata_attr() -> None:
    manifest = SimpleNamespace()
    assert extract_metadata(manifest) == {"generated_at": "", "project_name": ""}


def testextract_metadata_stringifies_non_string_fields() -> None:
    manifest = SimpleNamespace(metadata=SimpleNamespace(generated_at=None, project_name=None))
    assert extract_metadata(manifest) == {"generated_at": "", "project_name": ""}


def test_build_erd_handles_table_without_columns() -> None:
    table = Table(
        name="empty",
        database="db",
        schema="sch",
        columns=None,
        resource_type="source",
        node_name="source.pkg.empty",
        exposures=[],
    )
    out = JsonAdapter().build_erd([table], [])
    payload = json.loads(out)
    assert payload["tables"][0]["columns"] == []
    assert payload["tables"][0]["exposures"] == []
