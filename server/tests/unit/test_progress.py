"""Unit tests for the pluggable phase model and ProgressReporter in erd/progress.py."""

from dbterd_server.erd.progress import (
    MIN_ITEMS_FOR_PER_ITEM_PROGRESS,
    PHASES,
    ProgressReporter,
    _interpolate,
)
from dbterd_server.schemas.erd import ErdProgress

# ---------------------------------------------------------------------------
# Phase registry sanity checks
# ---------------------------------------------------------------------------


def test_phases_covers_all_known_phases() -> None:
    names = {p.name for p in PHASES}
    # The canonical phase names come from the ProgressPhase Literal in schemas/erd.py.
    # "invoking_done" is an internal builder alias not exposed as a ProgressPhase.
    expected = {
        "validating",
        "configuring",
        "invoking",
        "mapping_nodes",
        "mapping_edges",
        "postprocessing",
        "done",
    }
    assert expected.issubset(names)


def test_phases_point_start_equals_end() -> None:
    for phase in PHASES:
        if phase.kind == "point":
            assert phase.start_pct == phase.end_pct, f"point phase {phase.name!r} has start != end"


def test_phases_span_start_less_than_end() -> None:
    for phase in PHASES:
        if phase.kind == "span":
            assert phase.start_pct < phase.end_pct, f"span phase {phase.name!r} has start >= end"


def test_phases_percents_in_range() -> None:
    for phase in PHASES:
        assert 0 <= phase.start_pct <= 100
        assert 0 <= phase.end_pct <= 100


# ---------------------------------------------------------------------------
# _interpolate
# ---------------------------------------------------------------------------


def test_interpolate_zero_total_returns_end() -> None:
    assert _interpolate(65, 80, 0, 0) == 80


def test_interpolate_midpoint() -> None:
    # 50% through → 65 + round(0.5*15) = 65 + 8 = 73 (round(7.5)=8 in Python)
    assert _interpolate(65, 80, 5, 10) == 73


def test_interpolate_full_range_returns_end() -> None:
    assert _interpolate(65, 80, 10, 10) == 80


def test_interpolate_first_item() -> None:
    # index=1 of 10 → 65 + round(0.1*15) = 65 + 2 = 67
    assert _interpolate(65, 80, 1, 10) == 67


# ---------------------------------------------------------------------------
# ProgressReporter.emit
# ---------------------------------------------------------------------------


def test_reporter_emit_noop_when_no_callback() -> None:
    reporter = ProgressReporter(None)
    reporter.emit("validating", 0, "msg")  # must not raise


def test_reporter_emit_calls_callback() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    reporter.emit("validating", 0, "hello")
    assert len(received) == 1
    assert received[0].phase == "validating"
    assert received[0].percent == 0
    assert received[0].message == "hello"


def test_reporter_emit_clamps_below_zero() -> None:
    received: list[ErdProgress] = []
    ProgressReporter(received.append).emit("validating", -5, "msg")
    assert received[0].percent == 0


def test_reporter_emit_clamps_above_100() -> None:
    received: list[ErdProgress] = []
    ProgressReporter(received.append).emit("done", 200, "msg")
    assert received[0].percent == 100


# ---------------------------------------------------------------------------
# ProgressReporter.emit_point
# ---------------------------------------------------------------------------


def test_reporter_emit_point_uses_phase_percent() -> None:
    received: list[ErdProgress] = []
    ProgressReporter(received.append).emit_point("validating", "validating project path")
    assert received[0].percent == 0
    assert received[0].phase == "validating"


def test_reporter_emit_point_done_is_100() -> None:
    received: list[ErdProgress] = []
    ProgressReporter(received.append).emit_point("done", "done — 5 nodes, 2 edges")
    assert received[0].percent == 100


# ---------------------------------------------------------------------------
# ProgressReporter.report_span
# ---------------------------------------------------------------------------


def test_reporter_report_span_interpolates() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    reporter.report_span("mapping_nodes", 5, 10, "mapping 5/10 nodes")
    assert received[0].phase == "mapping_nodes"
    # mapping_nodes: 65→80, 5/10 → 65+round(7.5)=73
    assert received[0].percent == 73


def test_reporter_report_span_noop_when_no_callback() -> None:
    reporter = ProgressReporter(None)
    reporter.report_span("mapping_nodes", 1, 10, "msg")  # must not raise


# ---------------------------------------------------------------------------
# ProgressReporter.report_mapping — per-item vs boundary threshold
# ---------------------------------------------------------------------------


def test_report_mapping_noop_when_no_callback() -> None:
    reporter = ProgressReporter(None)
    reporter.report_mapping("mapping_nodes", 1, 25, "nodes")  # must not raise


def test_report_mapping_emits_per_item_above_threshold() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    total = MIN_ITEMS_FOR_PER_ITEM_PROGRESS
    for i in range(1, total + 1):
        reporter.report_mapping("mapping_nodes", i, total, "nodes")
    assert len(received) == total


def test_report_mapping_message_contains_count() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    total = MIN_ITEMS_FOR_PER_ITEM_PROGRESS
    reporter.report_mapping("mapping_nodes", 1, total, "nodes")
    assert f"1/{total} nodes" in received[0].message


def test_report_mapping_emits_boundary_only_below_threshold() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    total = MIN_ITEMS_FOR_PER_ITEM_PROGRESS - 1
    for i in range(1, total + 1):
        reporter.report_mapping("mapping_nodes", i, total, "nodes")
    # Only the final boundary event should be emitted.
    assert len(received) == 1
    assert received[0].phase == "mapping_nodes"
    assert received[0].percent == 80  # mapping_nodes end_pct


def test_report_mapping_boundary_message_shows_total() -> None:
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    total = 5
    for i in range(1, total + 1):
        reporter.report_mapping("mapping_edges", i, total, "edges")
    assert f"{total}/{total} edges" in received[0].message


def test_report_mapping_index_zero_total_zero_emits_boundary() -> None:
    """Calling report_mapping(0, 0) satisfies index==total, so the boundary is emitted.

    In practice the builder's for-loop over an empty sequence never calls this,
    but the API contract is: index==total always triggers the boundary event for
    below-threshold collections.
    """
    received: list[ErdProgress] = []
    reporter = ProgressReporter(received.append)
    reporter.report_mapping("mapping_nodes", 0, 0, "nodes")
    assert len(received) == 1
    assert received[0].percent == 80  # mapping_nodes end_pct
