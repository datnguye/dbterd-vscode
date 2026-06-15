"""Pluggable phase model and progress reporter for ERD build pipelines.

Adding or retuning a phase means editing the PHASES registry here only —
builder.py loops are phase-agnostic.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from dbterd_server.schemas.erd import ErdProgress

# Minimum item count before per-item progress events are emitted within a
# mapping phase. Smaller collections get a single boundary emit instead.
MIN_ITEMS_FOR_PER_ITEM_PROGRESS = 20

OnProgress = Callable[[ErdProgress], None]

PhaseKind = Literal["point", "span"]


@dataclass(frozen=True)
class Phase:
    """Descriptor for one build phase.

    point phases have a single percent value (start_pct == end_pct).
    span phases interpolate between start_pct and end_pct as items are processed.
    """

    name: str
    kind: PhaseKind
    start_pct: int
    end_pct: int


# Canonical phase plan — ordered for documentation; reporter looks phases up
# by name so ordering here is informational only.
PHASES: tuple[Phase, ...] = (
    Phase(name="validating", kind="point", start_pct=0, end_pct=0),
    Phase(name="configuring", kind="point", start_pct=2, end_pct=2),
    Phase(name="invoking", kind="point", start_pct=5, end_pct=5),
    Phase(name="invoking_done", kind="point", start_pct=65, end_pct=65),
    Phase(name="mapping_nodes", kind="span", start_pct=65, end_pct=80),
    Phase(name="mapping_edges", kind="span", start_pct=80, end_pct=92),
    Phase(name="postprocessing", kind="point", start_pct=92, end_pct=92),
    Phase(name="done", kind="point", start_pct=100, end_pct=100),
)

_PHASE_INDEX: dict[str, Phase] = {p.name: p for p in PHASES}


def _interpolate(start: int, end: int, index: int, total: int) -> int:
    """Linearly interpolate a percent within [start, end] for item index of total.

    Returns end when total is 0 (nothing to map).
    """
    if total == 0:
        return end
    return start + round((end - start) * index / total)


class ProgressReporter:
    """Wraps an optional on_progress callback and exposes phase-aware emit helpers.

    All methods are no-ops when the callback is None, so callers never branch on
    whether progress reporting is enabled.
    """

    def __init__(self, on_progress: OnProgress | None) -> None:
        self._callback = on_progress

    def emit(self, phase_name: str, percent: int, message: str) -> None:
        """Emit a single progress event, clamping percent to [0, 100]."""
        if self._callback is None:
            return
        self._callback(
            ErdProgress(
                phase=phase_name,  # type: ignore[arg-type]
                percent=max(0, min(100, percent)),
                message=message,
            )
        )

    def emit_point(self, phase_name: str, message: str) -> None:
        """Emit the single percent defined for a point phase."""
        phase = _PHASE_INDEX[phase_name]
        self.emit(phase_name, phase.start_pct, message)

    def report_span(
        self,
        phase_name: str,
        index: int,
        total: int,
        message: str,
    ) -> None:
        """Emit a per-item event for item `index` (1-based) within a span phase."""
        phase = _PHASE_INDEX[phase_name]
        pct = _interpolate(phase.start_pct, phase.end_pct, index, total)
        self.emit(phase_name, pct, message)

    def report_mapping(
        self,
        phase_name: str,
        index: int,
        total: int,
        label: str,
    ) -> None:
        """Emit mapping progress respecting the per-item / boundary threshold.

        Call this after processing each item (index is 1-based, i.e. items
        processed so far). When total >= MIN_ITEMS_FOR_PER_ITEM_PROGRESS, one
        event per item is emitted. Otherwise nothing is emitted mid-loop and
        the boundary event is emitted only when index == total.
        """
        if self._callback is None:
            return
        message = f"mapping {index}/{total} {label}"
        if total >= MIN_ITEMS_FOR_PER_ITEM_PROGRESS:
            self.report_span(phase_name, index, total, message)
        elif index == total:
            phase = _PHASE_INDEX[phase_name]
            self.emit(phase_name, phase.end_pct, message)
