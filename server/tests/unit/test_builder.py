"""Unit tests for builder-level helpers that are not exercised by integration tests."""

import json
from pathlib import Path

from dbterd_server.erd.builder import _load_original_file_paths


def test_load_original_file_paths_returns_paths_for_all_sections(tmp_path: Path) -> None:
    manifest = {
        "nodes": {
            "model.proj.orders": {"original_file_path": "models/orders.sql"},
        },
        "sources": {
            "source.proj.raw": {"original_file_path": "models/raw.sql"},
        },
    }
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps(manifest))
    result = _load_original_file_paths(manifest_file)
    assert result == {
        "model.proj.orders": "models/orders.sql",
        "source.proj.raw": "models/raw.sql",
    }


def test_load_original_file_paths_skips_non_string_path(tmp_path: Path) -> None:
    manifest = {
        "nodes": {
            "model.proj.orders": {"original_file_path": None},
            "model.proj.items": {"original_file_path": 42},
        },
    }
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps(manifest))
    result = _load_original_file_paths(manifest_file)
    assert result == {}


def test_load_original_file_paths_skips_empty_string_path(tmp_path: Path) -> None:
    manifest = {
        "nodes": {
            "model.proj.orders": {"original_file_path": ""},
        },
    }
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps(manifest))
    result = _load_original_file_paths(manifest_file)
    assert result == {}


def test_load_original_file_paths_returns_empty_on_os_error(tmp_path: Path) -> None:
    missing = tmp_path / "nonexistent.json"
    result = _load_original_file_paths(missing)
    assert result == {}


def test_load_original_file_paths_returns_empty_on_invalid_json(tmp_path: Path) -> None:
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text("not valid json {{{")
    result = _load_original_file_paths(manifest_file)
    assert result == {}


def test_load_original_file_paths_tolerates_missing_section(tmp_path: Path) -> None:
    manifest = {
        "nodes": {
            "model.proj.orders": {"original_file_path": "models/orders.sql"},
        },
        # "sources" section absent
    }
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps(manifest))
    result = _load_original_file_paths(manifest_file)
    assert result == {"model.proj.orders": "models/orders.sql"}
