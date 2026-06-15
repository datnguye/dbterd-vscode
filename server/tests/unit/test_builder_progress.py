"""Unit tests for builder progress-emission helpers and the on_progress callback path."""

import json
import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from dbterd_server.api.service import ErdService
from dbterd_server.erd import builder
from dbterd_server.erd.builder import _emit, _mapping_percent
from dbterd_server.erd.cache import ErdCache
from dbterd_server.schemas import ErdProgress
from tests.conftest import FIXTURE_ROOT

# Shared fake payload used across per-item emission tests.
# Field names must match what dbterd's json target emits (the already-mapped
# format that builder._result_from_payload passes to map_node / map_edge).
_FAKE_25_NODES = [
    {
        "id": f"model.proj.node{i}",
        "name": f"node{i}",
        "resource_type": "model",
        "columns": [],
        "description": "",
        "label": f"node{i}",
    }
    for i in range(25)
]

_FAKE_2_NODES = [
    {
        "id": f"model.proj.{name}",
        "name": name,
        "resource_type": "model",
        "columns": [],
        "description": "",
        "label": name,
    }
    for name in ("a", "b")
]

_FAKE_25_EDGES = [
    {
        "id": f"edge.{i}",
        "from_id": "model.proj.a",
        "to_id": "model.proj.b",
        "from_columns": ["col_a"],
        "to_columns": ["col_b"],
        "relationship_type": "fk",
        "name": f"fk_{i}",
        "label": None,
    }
    for i in range(25)
]

_FAKE_METADATA = {"generated_at": "2024-01-01T00:00:00", "dbt_project_name": "test"}


# ---------------------------------------------------------------------------
# _emit helper
# ---------------------------------------------------------------------------


def test_emit_calls_on_progress() -> None:
    received: list[ErdProgress] = []
    _emit(received.append, "validating", 0, "validating project path")
    assert len(received) == 1
    assert received[0].phase == "validating"
    assert received[0].percent == 0
    assert received[0].message == "validating project path"


def test_emit_is_noop_when_callback_is_none() -> None:
    # Should not raise; coverage ensures the early-return branch is exercised.
    _emit(None, "validating", 0, "msg")


def test_emit_clamps_percent_below_zero() -> None:
    received: list[ErdProgress] = []
    _emit(received.append, "validating", -10, "msg")
    assert received[0].percent == 0


def test_emit_clamps_percent_above_100() -> None:
    received: list[ErdProgress] = []
    _emit(received.append, "done", 200, "msg")
    assert received[0].percent == 100


# ---------------------------------------------------------------------------
# _mapping_percent helper
# ---------------------------------------------------------------------------


def test_mapping_percent_zero_total_returns_end() -> None:
    assert _mapping_percent(65, 80, 0, 0) == 80


def test_mapping_percent_interpolates_at_midpoint() -> None:
    # With 10 items and index=5 (50%), result should be 65 + 0.5*(80-65)=72.5→73
    result = _mapping_percent(65, 80, 5, 10)
    assert result == 73


def test_mapping_percent_at_start_is_start_plus_one_step() -> None:
    # index=1 out of 10 → 65 + round(0.1*15) = 65 + 2 = 67
    result = _mapping_percent(65, 80, 1, 10)
    assert result == 67


def test_mapping_percent_at_end_returns_end() -> None:
    result = _mapping_percent(65, 80, 10, 10)
    assert result == 80


# ---------------------------------------------------------------------------
# build_erd with on_progress
# ---------------------------------------------------------------------------


def _collect_progress(fixture_project: Path, cache: ErdCache) -> list[ErdProgress]:
    received: list[ErdProgress] = []
    builder.build_erd(str(fixture_project), cache, on_progress=received.append)
    return received


def test_on_progress_is_called_with_validating_first(
    fixture_project: Path, cache: ErdCache
) -> None:
    progress = _collect_progress(fixture_project, cache)
    assert progress[0].phase == "validating"
    assert progress[0].percent == 0


def test_on_progress_ends_with_done_at_100(fixture_project: Path, cache: ErdCache) -> None:
    progress = _collect_progress(fixture_project, cache)
    assert progress[-1].phase == "done"
    assert progress[-1].percent == 100


def test_on_progress_is_monotonic(fixture_project: Path, cache: ErdCache) -> None:
    progress = _collect_progress(fixture_project, cache)
    for i in range(1, len(progress)):
        assert progress[i].percent >= progress[i - 1].percent, (
            f"percent not monotonic at index {i}: {progress[i - 1].percent} → {progress[i].percent}"
        )


def test_on_progress_all_percents_in_range(fixture_project: Path, cache: ErdCache) -> None:
    progress = _collect_progress(fixture_project, cache)
    for p in progress:
        assert 0 <= p.percent <= 100


def test_on_progress_includes_configuring_phase(fixture_project: Path, cache: ErdCache) -> None:
    phases = [p.phase for p in _collect_progress(fixture_project, cache)]
    assert "configuring" in phases


def test_on_progress_includes_invoking_phase(fixture_project: Path, cache: ErdCache) -> None:
    phases = [p.phase for p in _collect_progress(fixture_project, cache)]
    assert "invoking" in phases


def test_on_progress_includes_postprocessing_phase(fixture_project: Path, cache: ErdCache) -> None:
    phases = [p.phase for p in _collect_progress(fixture_project, cache)]
    assert "postprocessing" in phases


def test_on_progress_includes_mapping_nodes_phase(fixture_project: Path, cache: ErdCache) -> None:
    phases = [p.phase for p in _collect_progress(fixture_project, cache)]
    assert "mapping_nodes" in phases


def test_on_progress_includes_mapping_edges_phase(fixture_project: Path, cache: ErdCache) -> None:
    phases = [p.phase for p in _collect_progress(fixture_project, cache)]
    assert "mapping_edges" in phases


def test_on_progress_done_message_contains_node_and_edge_count(
    fixture_project: Path, cache: ErdCache
) -> None:
    done = _collect_progress(fixture_project, cache)[-1]
    assert "nodes" in done.message
    assert "edges" in done.message


def test_on_progress_cache_hit_emits_single_done(fixture_project: Path, cache: ErdCache) -> None:
    builder.build_erd(str(fixture_project), cache)
    received: list[ErdProgress] = []
    builder.build_erd(str(fixture_project), cache, on_progress=received.append)
    phases = [p.phase for p in received]
    assert "done" in phases
    assert "invoking" not in phases
    done_events = [p for p in received if p.phase == "done"]
    assert len(done_events) == 1
    assert done_events[0].percent == 100


# ---------------------------------------------------------------------------
# Per-item progress emissions (needs ≥20 nodes/edges to cross threshold)
# ---------------------------------------------------------------------------


def test_on_progress_per_item_mapping_nodes_emitted(tmp_path: Path, cache: ErdCache) -> None:
    """When there are ≥20 nodes, per-item node mapping events are emitted."""
    dest = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, dest)
    fake_payload = json.dumps({"nodes": _FAKE_25_NODES, "edges": [], "metadata": _FAKE_METADATA})
    received: list[ErdProgress] = []
    # Patch the name as imported by builder (not in the source module) so the
    # already-bound reference inside builder.py is replaced.
    with patch.object(builder, "invoke_dbterd", return_value=fake_payload):
        builder.build_erd(str(dest), cache, on_progress=received.append)

    mapping_nodes_events = [p for p in received if p.phase == "mapping_nodes"]
    assert len(mapping_nodes_events) == 25
    for i, event in enumerate(mapping_nodes_events, start=1):
        assert f"{i}/25" in event.message


def test_on_progress_per_item_mapping_edges_emitted(tmp_path: Path, cache: ErdCache) -> None:
    """When there are ≥20 edges, per-item edge mapping events are emitted."""
    dest = tmp_path / "project"
    shutil.copytree(FIXTURE_ROOT, dest)
    fake_payload = json.dumps(
        {"nodes": _FAKE_2_NODES, "edges": _FAKE_25_EDGES, "metadata": _FAKE_METADATA}
    )
    received: list[ErdProgress] = []
    # Patch the name as imported by builder.
    with patch.object(builder, "invoke_dbterd", return_value=fake_payload):
        builder.build_erd(str(dest), cache, on_progress=received.append)

    mapping_edges_events = [p for p in received if p.phase == "mapping_edges"]
    assert len(mapping_edges_events) == 25
    for i, event in enumerate(mapping_edges_events, start=1):
        assert f"{i}/25" in event.message


# ---------------------------------------------------------------------------
# service.build_with_progress
# ---------------------------------------------------------------------------


def test_service_build_with_progress_calls_callback(fixture_project: Path) -> None:
    cache = ErdCache()
    service = ErdService(default_project_path=str(fixture_project), cache=cache)
    received: list[ErdProgress] = []
    result = service.build_with_progress(str(fixture_project), on_progress=received.append)
    assert result is not None
    assert len(received) > 0
    assert received[-1].phase == "done"


# ---------------------------------------------------------------------------
# ErdProgress schema validation
# ---------------------------------------------------------------------------


def test_erd_progress_schema_fields() -> None:
    p = ErdProgress(phase="validating", percent=0, message="hello")
    assert p.phase == "validating"
    assert p.percent == 0
    assert p.message == "hello"


def test_erd_progress_model_dump_json_roundtrip() -> None:
    p = ErdProgress(phase="done", percent=100, message="done — 5 nodes, 3 edges")
    parsed = json.loads(p.model_dump_json())
    assert parsed["phase"] == "done"
    assert parsed["percent"] == 100


@pytest.mark.parametrize(
    "phase",
    [
        "validating",
        "configuring",
        "invoking",
        "mapping_nodes",
        "mapping_edges",
        "postprocessing",
        "done",
    ],
)
def test_erd_progress_all_phases_valid(phase: str) -> None:
    p = ErdProgress(phase=phase, percent=50, message="x")
    assert p.phase == phase
