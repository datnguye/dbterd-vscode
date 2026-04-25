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


def test_resolves_raw_sql_path_when_present(fixture_project: Path, cache: ErdCache) -> None:
    sql_path = fixture_project / "models" / "marts" / "customers.sql"
    sql_path.parent.mkdir(parents=True)
    sql_path.write_text("select 1 as id")
    result = builder.build_erd(str(fixture_project), cache)
    match = next(
        (n for n in result.payload.nodes if n.name.endswith(".customers")),
        None,
    )
    assert match is not None
    assert match.raw_sql_path is not None
    assert match.raw_sql_path.endswith("customers.sql")


def test_raw_sql_path_is_none_when_file_missing_on_disk(
    fixture_project: Path, cache: ErdCache
) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    match = next(
        (n for n in result.payload.nodes if n.name.endswith(".customers")),
        None,
    )
    assert match is not None
    assert match.raw_sql_path is None


def test_source_node_has_no_raw_sql_path(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    sources = [n for n in result.payload.nodes if n.resource_type == "source"]
    for src in sources:
        assert src.raw_sql_path is None


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
    parent = next(n for n in result.payload.nodes if n.id == first_edge.from_id)
    child = next(n for n in result.payload.nodes if n.id == first_edge.to_id)
    assert any(col.name == first_edge.from_column for col in parent.columns)
    assert any(col.name == first_edge.to_column for col in child.columns)
    injected = next(col for col in parent.columns if col.name == first_edge.from_column)
    assert injected.is_foreign_key is True
    assert injected.data_type is None


def test_marks_child_side_columns_as_foreign_key(fixture_project: Path, cache: ErdCache) -> None:
    result = builder.build_erd(str(fixture_project), cache)
    for edge in result.payload.edges:
        child = next(n for n in result.payload.nodes if n.id == edge.to_id)
        target_col = next(c for c in child.columns if c.name == edge.to_column)
        assert target_col.is_foreign_key is True, f"{edge.to_id}.{edge.to_column} missing FK flag"


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
