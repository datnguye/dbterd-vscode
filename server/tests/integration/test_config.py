"""Config loading exercises end-to-end (build_erd → DbtErd) so we cover both
the YAML/TOML reader *and* the kwarg pass-through."""

import os
from pathlib import Path

import pytest
from dbterd.core.registry.plugin_registry import PluginRegistry

from dbterd_server.erd import builder
from dbterd_server.erd.cache import ErdCache
from dbterd_server.erd.errors import ErdBuildError

_default_algo_class = PluginRegistry.get_algo("test_relationship")


def test_honors_dbterd_yml_entity_name_format(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / ".dbterd.yml").write_text("entity-name-format: model\n")
    result = builder.build_erd(str(fixture_project), cache)
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_passes_config_through_to_dbterd(
    fixture_project: Path, cache: ErdCache, monkeypatch: pytest.MonkeyPatch
) -> None:
    (fixture_project / ".dbterd.yml").write_text(
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
    builder.build_erd(str(fixture_project), cache)
    assert captured["entity_name_format"] == "model"
    assert captured["select"] == ["wildcard:mart_*"]
    assert captured["exclude"] == ["wildcard:stg_*"]
    assert captured["resource_type"] == ["model"]


def test_honors_pyproject_toml_config(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / "pyproject.toml").write_text('[tool.dbterd]\nentity-name-format = "model"\n')
    result = builder.build_erd(str(fixture_project), cache)
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_pyproject_without_tool_dbterd_is_ignored(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / "pyproject.toml").write_text('[tool.other]\nfoo = "bar"\n')
    result = builder.build_erd(str(fixture_project), cache)
    assert any(node.name.endswith(".customers") for node in result.payload.nodes)


def test_filters_unknown_config_keys(fixture_project: Path, cache: ErdCache) -> None:
    # "output" / "omit-columns" are dbterd CLI concerns — silently dropped.
    (fixture_project / ".dbterd.yml").write_text(
        "entity-name-format: model\noutput: dbml\nomit-columns: true\n"
    )
    result = builder.build_erd(str(fixture_project), cache)
    assert any(node.name == "customers" for node in result.payload.nodes)


def test_raises_on_unknown_algo(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / ".dbterd.yml").write_text("algo: not_a_real_algo\n")
    with pytest.raises(ErdBuildError, match="dbterd rejected configuration"):
        builder.build_erd(str(fixture_project), cache)


def test_honors_model_contract_algo(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / ".dbterd.yml").write_text("algo: model_contract\n")
    # Smoke test only — coverage is about confirming the algo dispatch path.
    result = builder.build_erd(str(fixture_project), cache)
    assert len(result.payload.nodes) > 0


def test_raises_on_malformed_yaml_config(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / ".dbterd.yml").write_text(": : not valid yaml :")
    with pytest.raises(ErdBuildError, match="Invalid dbterd config"):
        builder.build_erd(str(fixture_project), cache)


def test_raises_on_malformed_pyproject_config(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / "pyproject.toml").write_text("this is not = valid toml [")
    with pytest.raises(ErdBuildError, match="Invalid dbterd config"):
        builder.build_erd(str(fixture_project), cache)


def test_yaml_config_non_mapping_is_ignored(fixture_project: Path, cache: ErdCache) -> None:
    (fixture_project / ".dbterd.yml").write_text("- item1\n- item2\n")
    result = builder.build_erd(str(fixture_project), cache)
    assert any(node.name.endswith(".customers") for node in result.payload.nodes)


def test_invalidates_cache_when_config_changes(fixture_project: Path, cache: ErdCache) -> None:
    config_file = fixture_project / ".dbterd.yml"
    config_file.write_text("entity-name-format: model\n")
    first = builder.build_erd(str(fixture_project), cache)
    config_file.write_text("entity-name-format: resource.package.model\n")
    stat = config_file.stat()
    os.utime(config_file, ns=(stat.st_atime_ns, stat.st_mtime_ns + 2_000_000_000))
    second = builder.build_erd(str(fixture_project), cache)
    assert first is not second
    assert any(n.name == "customers" for n in first.payload.nodes)
    assert any(n.name.endswith(".customers") for n in second.payload.nodes)
