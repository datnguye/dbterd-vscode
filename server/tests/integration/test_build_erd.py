import os
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from dbterd.core.registry.plugin_registry import PluginRegistry

from dbterd_server.erd import builder
from dbterd_server.erd.cache import ErdCache
from dbterd_server.erd.errors import ErdBuildError, ManifestMissingError
from tests.conftest import FIXTURE_ROOT

# Tests that need to observe or inject parse_artifacts behavior go through the
# registry — same dispatch path build_erd uses via DbtErd. Pinning directly to
# a specific algo class would hide real breakage if the registry ever stopped
# resolving.
_default_algo_class = PluginRegistry.get_algo("test_relationship")


def test_happy_path(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    assert result.catalog_missing is False
    assert len(result.payload.nodes) > 0
    assert result.payload.metadata.dbt_project_name == "jaffle_shop"
    # Fixture has FK relationships → at least one edge should be present.
    assert len(result.payload.edges) >= 1
    first_edge = result.payload.edges[0]
    assert first_edge.relationship_type == "fk"
    assert first_edge.from_column
    assert first_edge.to_column


def test_missing_catalog_is_graceful(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / "target" / "catalog.json").unlink()
    result = builder.build_erd(str(fixture_project), cache)
    assert result.catalog_missing is True
    assert len(result.payload.nodes) > 0


def test_missing_manifest_raises(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / "target" / "manifest.json").unlink()
    with pytest.raises(ManifestMissingError):
        builder.build_erd(str(fixture_project), cache)


def test_missing_project_path_raises(cache: ErdCache) -> None:
    with pytest.raises(ErdBuildError):
        builder.build_erd("", cache)


def test_project_path_does_not_exist(tmp_path: Path, cache: ErdCache) -> None:
    with pytest.raises(ErdBuildError):
        builder.build_erd(str(tmp_path / "nope"), cache)


def test_caches_on_mtime(fixture_project: Path, cache: ErdCache) -> None:
    first = builder.build_erd(str(fixture_project), cache)
    with patch.object(
        _default_algo_class,
        "parse_artifacts",
        side_effect=AssertionError("cache miss — should not re-parse"),
    ):
        second = builder.build_erd(str(fixture_project), cache)
    assert first is second


def test_reparses_when_manifest_changes(fixture_project: Path, cache: ErdCache) -> None:
    first = builder.build_erd(str(fixture_project), cache)
    manifest = fixture_project / "target" / "manifest.json"
    stat = manifest.stat()
    os.utime(manifest, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    second = builder.build_erd(str(fixture_project), cache)
    assert first is not second


def test_uses_manifest_project_name(fixture_project: Path, cache: ErdCache) -> None:
    # Sourced from manifest.metadata.project_name via the json target,
    # not from dbt_project.yml. Stripping dbt_project.yml is a no-op.
    (fixture_project / "dbt_project.yml").unlink()
    result = builder.build_erd(str(fixture_project), cache)
    assert result.payload.metadata.dbt_project_name == "jaffle_shop"


def test_compiled_sql_is_set_for_model_nodes(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    models = [n for n in result.payload.nodes if n.resource_type == "model"]
    assert models, "expected at least one model node in the fixture"
    for model in models:
        assert model.compiled_sql is not None, f"{model.name} missing compiled_sql"


def test_customers_compiled_sql_contains_select(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    customers = next(
        (n for n in result.payload.nodes if n.name.endswith(".customers")),
        None,
    )
    assert customers is not None
    assert customers.compiled_sql is not None
    assert "select" in customers.compiled_sql.lower()


def test_model_nodes_have_no_raw_sql_path_attribute(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    for node in result.payload.nodes:
        assert not hasattr(node, "raw_sql_path"), (
            f"ErdNode should not have raw_sql_path; found on {node.name}"
        )


def test_evicts_oldest_entry_over_cache_cap(tmp_path: Path) -> None:
    cap = 8
    cache = ErdCache(max_entries=cap)
    for i in range(cap + 2):
        project = tmp_path / f"project_{i}"
        shutil.copytree(FIXTURE_ROOT, project)
        builder.build_erd(str(project), cache)
    assert len(cache) == cap


def test_injects_referenced_columns_when_catalog_misses_them(
    fixture_project: Path, cache: ErdCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        # Simulate partial catalog: wipe columns from the two endpoint tables
        # of the first ref. The injection pass should refill the FK columns.
        if refs:
            parent_id, child_id = refs[0].table_map
            for table in tables:
                if table.node_name in (parent_id, child_id):
                    table.columns = []
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = builder.build_erd(str(fixture_project), cache)
    assert len(result.payload.edges) >= 1
    first_edge = result.payload.edges[0]
    from_node = next(n for n in result.payload.nodes if n.id == first_edge.from_id)
    to_node = next(n for n in result.payload.nodes if n.id == first_edge.to_id)
    assert any(col.name == first_edge.from_column for col in from_node.columns)
    assert any(col.name == first_edge.to_column for col in to_node.columns)
    injected = next(col for col in from_node.columns if col.name == first_edge.from_column)
    assert injected.is_foreign_key is True
    assert injected.data_type is None


def test_reconciles_short_name_edge_endpoints_to_node_ids(
    fixture_project: Path, cache: ErdCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Reproduces the `model_contract` + `entity-name-format: model` quirk: the
    # algo builds refs whose table_map uses the short `Table.name` ("orders")
    # while node ids stay fully qualified ("model.jaffle_shop.orders"). The
    # webview matches edge source/target on node id, so unreconciled short-name
    # endpoints would drop every edge from the canvas.
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        # `entity-name-format: model` shortens `Table.name` to the last dotted
        # segment ("orders") while `node_name` (→ node id) stays fully
        # qualified. The json target then emits short edge endpoints but fully
        # qualified node ids — the exact mismatch that drops every edge.
        for table in tables:
            table.name = table.node_name.split(".")[-1]
        for ref in refs:
            to_id, from_id = ref.table_map
            ref.table_map = (to_id.split(".")[-1], from_id.split(".")[-1])
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = builder.build_erd(str(fixture_project), cache)
    node_ids = {n.id for n in result.payload.nodes}
    assert len(result.payload.edges) >= 1, "edges must survive reconciliation, not vanish"
    for edge in result.payload.edges:
        assert edge.from_id in node_ids, f"from_id {edge.from_id!r} not reconciled to a node id"
        assert edge.to_id in node_ids, f"to_id {edge.to_id!r} not reconciled to a node id"


def test_from_side_columns_are_marked_as_foreign_key(
    fixture_project: Path, cache: ErdCache
) -> None:
    # dbterd's json target sets is_foreign_key=True on from_column (the child
    # table that holds the FK constraint). The to_column is the referenced PK.
    result = builder.build_erd(str(fixture_project), cache)
    assert result.payload.edges, "expected at least one edge in the fixture"
    for edge in result.payload.edges:
        from_node = next(n for n in result.payload.nodes if n.id == edge.from_id)
        fk_col = next((c for c in from_node.columns if c.name == edge.from_column), None)
        assert fk_col is not None, f"column {edge.from_column} missing from {edge.from_id}"
        assert fk_col.is_foreign_key is True, (
            f"{edge.from_id}.{edge.from_column} expected is_foreign_key=True"
        )


def test_skips_refs_with_empty_column_map(
    fixture_project: Path, cache: ErdCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        for ref in refs:
            ref.column_map = ([], [])
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = builder.build_erd(str(fixture_project), cache)
    assert result.payload.edges == []


def test_uses_fallback_resource_type(
    fixture_project: Path, cache: ErdCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        if tables:
            tables[0].resource_type = "unknown"
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = builder.build_erd(str(fixture_project), cache)
    assert result.payload.nodes[0].resource_type == "model"
