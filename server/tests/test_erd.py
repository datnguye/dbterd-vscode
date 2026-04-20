import os
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest
from dbterd.core.registry.plugin_registry import PluginRegistry
from fastapi import FastAPI
from fastapi.testclient import TestClient

from dbterd_server import erd as erd_module
from dbterd_server.erd import (
    ErdBuildError,
    ManifestMissingError,
    build_erd,
    clear_cache,
)
from dbterd_server.main import app as fastapi_app

# Tests that need to observe or inject parse_artifacts behavior go through the
# registry — same dispatch path build_erd uses via DbtErd. Pinning directly to
# a specific algo class would hide real breakage if the registry ever stopped
# resolving.
_default_algo_class = PluginRegistry.get_algo("test_relationship")

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "jaffle_shop"


@pytest.fixture(autouse=True)
def _reset_cache() -> None:
    clear_cache()


def _copy_fixture(dest: Path) -> Path:
    shutil.copytree(FIXTURE_ROOT, dest)
    return dest


def test_build_erd_happy_path(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    result = build_erd(str(project))
    assert result.catalog_missing is False
    assert len(result.payload.nodes) > 0
    assert result.payload.dbt_project_name == "jaffle_shop"
    # Fixture has FK relationships → at least one edge should be present.
    assert len(result.payload.edges) >= 1
    first_edge = result.payload.edges[0]
    assert first_edge.relationship_type == "fk"
    assert first_edge.from_column
    assert first_edge.to_column


def test_build_erd_missing_catalog_is_graceful(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "target" / "catalog.json").unlink()
    result = build_erd(str(project))
    assert result.catalog_missing is True
    assert len(result.payload.nodes) > 0


def test_build_erd_missing_manifest_raises(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "target" / "manifest.json").unlink()
    with pytest.raises(ManifestMissingError):
        build_erd(str(project))


def test_build_erd_missing_project_path_raises() -> None:
    with pytest.raises(ErdBuildError):
        build_erd("")


def test_build_erd_project_path_does_not_exist(tmp_path: Path) -> None:
    with pytest.raises(ErdBuildError):
        build_erd(str(tmp_path / "nope"))


def test_build_erd_caches_on_mtime(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    first = build_erd(str(project))
    with patch.object(
        _default_algo_class,
        "parse_artifacts",
        side_effect=AssertionError("cache miss — should not re-parse"),
    ):
        second = build_erd(str(project))
    assert first is second


def test_build_erd_reparses_when_manifest_changes(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    first = build_erd(str(project))
    manifest = project / "target" / "manifest.json"
    # Bump mtime deterministically without altering content.
    stat = manifest.stat()
    os.utime(manifest, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    second = build_erd(str(project))
    assert first is not second


def test_build_erd_uses_manifest_project_name(tmp_path: Path) -> None:
    # Now sourced from manifest.metadata.project_name via the json target,
    # not from dbt_project.yml. Stripping dbt_project.yml is a no-op.
    project = _copy_fixture(tmp_path / "project")
    (project / "dbt_project.yml").unlink()
    result = build_erd(str(project))
    assert result.payload.dbt_project_name == "jaffle_shop"


def test_build_erd_resolves_raw_sql_path_when_present(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    # The fixture manifest declares original_file_path=models/marts/customers.sql
    # for model.jaffle_shop.customers; stage that file on disk so the resolver
    # has something to verify against.
    sql_path = project / "models" / "marts" / "customers.sql"
    sql_path.parent.mkdir(parents=True)
    sql_path.write_text("select 1 as id")
    result = build_erd(str(project))
    match = next(
        (n for n in result.payload.nodes if n.name.endswith(".customers")),
        None,
    )
    assert match is not None
    assert match.raw_sql_path is not None
    assert match.raw_sql_path.endswith("customers.sql")


def test_build_erd_raw_sql_path_is_none_when_file_missing_on_disk(tmp_path: Path) -> None:
    # Manifest knows the original_file_path, but the .sql isn't on disk (e.g.
    # user deleted it after `dbt compile`). We'd rather return None than a
    # broken link that fails when the user clicks the header.
    project = _copy_fixture(tmp_path / "project")
    result = build_erd(str(project))
    match = next(
        (n for n in result.payload.nodes if n.name.endswith(".customers")),
        None,
    )
    assert match is not None
    assert match.raw_sql_path is None


def test_resolve_raw_sql_path_returns_none_when_payload_lacks_path() -> None:
    assert (
        erd_module._resolve_raw_sql_path(
            {"resource_type": "model", "original_file_path": None},
            Path("/tmp"),
        )
        is None
    )


def test_resolve_raw_sql_path_returns_none_for_non_model_node() -> None:
    assert (
        erd_module._resolve_raw_sql_path(
            {"resource_type": "seed", "original_file_path": "seeds/x.csv"},
            Path("/tmp"),
        )
        is None
    )


def test_resolve_raw_sql_path_returns_none_when_path_not_string() -> None:
    assert (
        erd_module._resolve_raw_sql_path(
            {"resource_type": "model", "original_file_path": 123},
            Path("/tmp"),
        )
        is None
    )


def _ref_dict(parent: str, child: str, parent_cols: list[str], child_cols: list[str], **kw) -> dict:
    return {
        "name": kw.get("name", "r1"),
        "type": kw.get("type", "n1"),
        "table_map": [parent, child],
        "column_map": [parent_cols, child_cols],
        "relationship_label": kw.get("relationship_label"),
    }


def test_map_ref_skips_mismatched_column_lengths() -> None:
    ref = _ref_dict("a", "b", ["x", "y"], ["z"])
    assert erd_module._map_ref(ref, 0) is None


def test_map_ref_normalizes_unknown_cardinality() -> None:
    ref = _ref_dict("a", "b", ["x"], ["y"], type="weird-value")
    edge = erd_module._map_ref(ref, 0)
    assert edge is not None
    assert edge.cardinality == ""


def test_map_ref_returns_none_for_empty_parent_columns() -> None:
    assert erd_module._map_ref(_ref_dict("a", "b", [], ["x"]), 0) is None


def test_map_ref_returns_none_for_empty_child_columns() -> None:
    assert erd_module._map_ref(_ref_dict("a", "b", ["x"], []), 0) is None


def test_map_ref_falls_back_to_ref_prefix_when_name_missing() -> None:
    ref = _ref_dict("a", "b", ["x"], ["y"], name=None)
    edge = erd_module._map_ref(ref, 3)
    assert edge is not None
    assert edge.id == "ref__3"


def test_build_erd_evicts_oldest_entry_over_cache_cap(tmp_path: Path) -> None:
    # Project N distinct paths and ensure the cache stays bounded.
    cap = erd_module._CACHE_MAX_ENTRIES
    for i in range(cap + 2):
        project = _copy_fixture(tmp_path / f"project_{i}")
        build_erd(str(project))
    assert len(erd_module._cache) == cap


def test_build_erd_source_node_has_no_raw_sql_path(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    result = build_erd(str(project))
    sources = [n for n in result.payload.nodes if n.resource_type == "source"]
    for src in sources:
        assert src.raw_sql_path is None


def test_build_erd_injects_referenced_columns_when_catalog_misses_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _copy_fixture(tmp_path / "project")
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
    result = build_erd(str(project))
    assert len(result.payload.edges) >= 1
    first_edge = result.payload.edges[0]
    parent = next(n for n in result.payload.nodes if n.id == first_edge.from_id)
    child = next(n for n in result.payload.nodes if n.id == first_edge.to_id)
    assert any(col.name == first_edge.from_column for col in parent.columns)
    assert any(col.name == first_edge.to_column for col in child.columns)
    # Injected columns are tagged as FK so the webview can style them.
    injected = next(col for col in parent.columns if col.name == first_edge.from_column)
    assert injected.is_foreign_key is True
    assert injected.data_type is None


def test_build_erd_marks_child_side_columns_as_foreign_key(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    result = build_erd(str(project))
    # Each edge's to_column on the to_id node should be flagged is_foreign_key.
    for edge in result.payload.edges:
        child = next(n for n in result.payload.nodes if n.id == edge.to_id)
        target_col = next(c for c in child.columns if c.name == edge.to_column)
        assert target_col.is_foreign_key is True, f"{edge.to_id}.{edge.to_column} missing FK flag"


def test_mark_foreign_key_columns_handles_missing_node() -> None:
    erd_module._mark_foreign_key_columns([], [_ref_dict("ghost", "ghost", ["x"], ["y"])])


def test_mark_foreign_key_columns_skips_unknown_column_name() -> None:
    node = erd_module.ErdNode(
        id="n1",
        name="n1",
        resource_type="model",
        schema_name=None,
        database=None,
        columns=[
            erd_module.Column(
                name="id",
                data_type="bigint",
                description=None,
                is_primary_key=True,
                is_foreign_key=False,
            )
        ],
        raw_sql_path=None,
    )
    erd_module._mark_foreign_key_columns([node], [_ref_dict("parent", "n1", ["x"], ["missing"])])
    assert node.columns[0].is_foreign_key is False


def test_mark_foreign_key_columns_marks_composite_fks() -> None:
    node = erd_module.ErdNode(
        id="fct",
        name="fct",
        resource_type="model",
        schema_name=None,
        database=None,
        columns=[
            erd_module.Column(
                name=c,
                data_type="text",
                description=None,
                is_primary_key=False,
                is_foreign_key=False,
            )
            for c in ("customer_id", "segment_code", "other")
        ],
        raw_sql_path=None,
    )
    erd_module._mark_foreign_key_columns(
        [node],
        [
            _ref_dict(
                "dim",
                "fct",
                ["customer_id", "segment_code"],
                ["customer_id", "segment_code"],
            )
        ],
    )
    marked = {c.name for c in node.columns if c.is_foreign_key}
    assert marked == {"customer_id", "segment_code"}


def test_mark_foreign_key_columns_skips_malformed_ref() -> None:
    node = erd_module.ErdNode(
        id="fct",
        name="fct",
        resource_type="model",
        schema_name=None,
        database=None,
        columns=[],
        raw_sql_path=None,
    )
    # Missing table_map / column_map entirely shouldn't explode.
    erd_module._mark_foreign_key_columns([node], [{}])
    erd_module._mark_foreign_key_columns([node], [{"table_map": ["a"], "column_map": [[]]}])


def test_inject_column_is_noop_when_node_missing() -> None:
    erd_module._inject_column(None, "foo")


def test_inject_column_is_noop_when_column_name_empty() -> None:
    node = erd_module.ErdNode(
        id="n1",
        name="n1",
        resource_type="model",
        schema_name=None,
        database=None,
        columns=[],
        raw_sql_path=None,
    )
    erd_module._inject_column(node, None)
    assert node.columns == []


def test_inject_column_does_not_duplicate() -> None:
    node = erd_module.ErdNode(
        id="n1",
        name="n1",
        resource_type="model",
        schema_name=None,
        database=None,
        columns=[
            erd_module.Column(
                name="id",
                data_type="bigint",
                description=None,
                is_primary_key=True,
                is_foreign_key=False,
            )
        ],
        raw_sql_path=None,
    )
    erd_module._inject_column(node, "id")
    assert len(node.columns) == 1
    assert node.columns[0].is_primary_key is True  # existing column preserved


def test_build_erd_skips_refs_with_empty_column_map_via_monkeypatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _copy_fixture(tmp_path / "project")
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        # Neuter every ref's column_map so the for-loop exercises the skip branch.
        for ref in refs:
            ref.column_map = ([], [])
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = build_erd(str(project))
    assert result.payload.edges == []


def test_build_erd_uses_fallback_resource_type(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _copy_fixture(tmp_path / "project")
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        tables, refs = real(self, **kwargs)
        if tables:
            tables[0].resource_type = "unknown"
        return tables, refs

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    result = build_erd(str(project))
    assert result.payload.nodes[0].resource_type == "model"


def test_build_erd_honors_dbterd_yml_entity_name_format(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / ".dbterd.yml").write_text("entity-name-format: model\n")
    result = build_erd(str(project))
    # Default format is "resource.package.model" → e.g. "model.jaffle_shop.customers".
    # With "model" override, the Table.name should be just "customers".
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_build_erd_passes_config_through_to_dbterd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / ".dbterd.yml").write_text(
        "entity-name-format: model\n"
        "select:\n  - wildcard:mart_*\n"
        "exclude:\n  - wildcard:stg_*\n"
        "resource-type:\n  - model\n"
    )
    captured: dict[str, object] = {}
    real = _default_algo_class.parse_artifacts

    def patched(self, **kwargs):  # type: ignore[no-untyped-def]
        captured.update(kwargs)
        return real(self, **kwargs)

    monkeypatch.setattr(_default_algo_class, "parse_artifacts", patched)
    build_erd(str(project))
    assert captured["entity_name_format"] == "model"
    assert captured["select"] == ["wildcard:mart_*"]
    assert captured["exclude"] == ["wildcard:stg_*"]
    assert captured["resource_type"] == ["model"]


def test_build_erd_honors_pyproject_toml_config(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "pyproject.toml").write_text('[tool.dbterd]\nentity-name-format = "model"\n')
    result = build_erd(str(project))
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_build_erd_pyproject_without_tool_dbterd_is_ignored(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    # pyproject.toml present but no [tool.dbterd] — treated as "no config".
    (project / "pyproject.toml").write_text('[tool.other]\nfoo = "bar"\n')
    result = build_erd(str(project))
    # Default entity-name-format is "resource.package.model".
    assert any(node.name.endswith(".customers") for node in result.payload.nodes)


def test_build_erd_filters_unknown_config_keys(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    # "output" / "omit-columns" are dbterd CLI concerns — our builder should
    # silently drop them rather than pass them into DbtErd.
    (project / ".dbterd.yml").write_text(
        "entity-name-format: model\noutput: dbml\nomit-columns: true\n"
    )
    result = build_erd(str(project))
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_build_erd_raises_on_unknown_algo(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / ".dbterd.yml").write_text("algo: not_a_real_algo\n")
    with pytest.raises(ErdBuildError, match="dbterd rejected configuration"):
        build_erd(str(project))


def test_build_erd_honors_model_contract_algo(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / ".dbterd.yml").write_text("algo: model_contract\n")
    # Smoke test only — coverage here is about confirming the algo dispatch
    # path, not about model_contract's output. Fixture doesn't have contracts
    # so refs will be empty, but nodes should still populate.
    result = build_erd(str(project))
    assert len(result.payload.nodes) > 0


def test_build_erd_raises_on_malformed_yaml_config(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / ".dbterd.yml").write_text(": : not valid yaml :")
    with pytest.raises(ErdBuildError, match="Invalid dbterd config"):
        build_erd(str(project))


def test_build_erd_raises_on_malformed_pyproject_config(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "pyproject.toml").write_text("this is not = valid toml [")
    with pytest.raises(ErdBuildError, match="Invalid dbterd config"):
        build_erd(str(project))


def test_build_erd_yaml_config_non_mapping_is_ignored(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    # A YAML list isn't a config map — treat as empty and fall through to defaults.
    (project / ".dbterd.yml").write_text("- item1\n- item2\n")
    result = build_erd(str(project))
    assert any(node.name.endswith(".customers") for node in result.payload.nodes)


def test_build_erd_invalidates_cache_when_config_changes(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    config_file = project / ".dbterd.yml"
    config_file.write_text("entity-name-format: model\n")
    first = build_erd(str(project))
    # Rewrite with the default format → names should shift back to fully-qualified.
    config_file.write_text("entity-name-format: resource.package.model\n")
    # Ensure mtime bumps beyond filesystem resolution.
    stat = config_file.stat()
    os.utime(config_file, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
    second = build_erd(str(project))
    assert first is not second
    assert any(n.name == "customers" for n in first.payload.nodes)
    assert any(n.name.endswith(".customers") for n in second.payload.nodes)


def test_parse_generated_at_accepts_iso_zulu() -> None:
    dt = erd_module._parse_generated_at("2026-04-04T05:08:37.907328Z")
    assert dt.year == 2026
    assert dt.tzinfo is not None


def test_parse_generated_at_falls_back_on_garbage() -> None:
    before = erd_module.datetime.now(erd_module.timezone.utc)
    dt = erd_module._parse_generated_at("not-a-date")
    after = erd_module.datetime.now(erd_module.timezone.utc)
    assert before <= dt <= after


def test_parse_generated_at_falls_back_on_empty() -> None:
    dt = erd_module._parse_generated_at("")
    assert dt.tzinfo is not None


def test_parse_generated_at_falls_back_on_none() -> None:
    dt = erd_module._parse_generated_at(None)
    assert dt.tzinfo is not None


def _make_client_with_project(project_path: str) -> TestClient:
    fastapi_app.state.project_path = project_path
    return TestClient(fastapi_app)


def test_erd_endpoint_happy_path(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    client = _make_client_with_project(str(project))
    response = client.get("/erd")
    assert response.status_code == 200
    assert "X-Erd-Warnings" not in response.headers
    body = response.json()
    assert len(body["nodes"]) > 0


def test_erd_endpoint_emits_catalog_warning(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "target" / "catalog.json").unlink()
    client = _make_client_with_project(str(project))
    response = client.get("/erd")
    assert response.status_code == 200
    assert response.headers.get("X-Erd-Warnings") == "catalog-missing"


def test_erd_endpoint_returns_404_on_missing_manifest(tmp_path: Path) -> None:
    project = _copy_fixture(tmp_path / "project")
    (project / "target" / "manifest.json").unlink()
    client = _make_client_with_project(str(project))
    response = client.get("/erd")
    assert response.status_code == 404


def test_erd_endpoint_returns_400_without_project_path() -> None:
    fastapi_app.state.project_path = ""
    client = TestClient(fastapi_app)
    response = client.get("/erd")
    assert response.status_code == 400


def test_erd_endpoint_handles_lifespan_default(client: TestClient, app: FastAPI) -> None:
    # Covers the default FastAPI error path when project_path is unset.
    app.state.project_path = ""
    assert client.get("/erd").status_code == 400
