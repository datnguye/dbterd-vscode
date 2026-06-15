"""Tests for the GET /erd/stream SSE endpoint."""

import json
import shutil
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from dbterd_server.api.app import create_app
from dbterd_server.api.service import ErdService
from dbterd_server.erd.cache import ErdCache
from dbterd_server.erd.errors import (
    ConfigInvalidError,
    ManifestMissingError,
    ProjectPathInvalidError,
    ProjectPathMissingError,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_sse(raw: str) -> list[dict]:
    """Parse SSE text into a list of {event, data} dicts.

    Each SSE frame is separated by a blank line. Lines starting with
    'event:' set the event type; lines starting with 'data:' carry the JSON.
    """
    frames = []
    for block in raw.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        event = None
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data_lines.append(line[len("data:") :].strip())
        if event is not None:
            frames.append({"event": event, "data": "\n".join(data_lines)})
    return frames


def _client_for(project_path: str, allowed: frozenset[str] | None = None) -> TestClient:
    service = ErdService(default_project_path=project_path, allowed_project_paths=allowed)
    return TestClient(create_app(service=service))


def _stream_frames(client: TestClient, url: str) -> list[dict]:
    """Collect all SSE frames from a streaming GET request."""
    with client.stream("GET", url) as response:
        raw = response.read().decode()
    return _parse_sse(raw)


# ---------------------------------------------------------------------------
# _parse_sse helper tests
# ---------------------------------------------------------------------------


def test_parse_sse_single_frame() -> None:
    raw = "event: progress\ndata: {}\n\n"
    frames = _parse_sse(raw)
    assert len(frames) == 1
    assert frames[0]["event"] == "progress"
    assert frames[0]["data"] == "{}"


def test_parse_sse_multiple_frames() -> None:
    raw = 'event: progress\ndata: {"a":1}\n\nevent: result\ndata: {"b":2}\n\n'
    frames = _parse_sse(raw)
    assert len(frames) == 2
    assert frames[0]["event"] == "progress"
    assert frames[1]["event"] == "result"


def test_parse_sse_ignores_empty_blocks() -> None:
    raw = "\n\nevent: result\ndata: {}\n\n\n\n"
    frames = _parse_sse(raw)
    assert len(frames) == 1


# ---------------------------------------------------------------------------
# Happy-path streaming tests
# ---------------------------------------------------------------------------


def test_stream_emits_progress_then_result(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    events = [f["event"] for f in frames]
    assert "progress" in events
    assert events[-1] == "result"


def test_stream_result_carries_erd_payload(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    result_frame = next(f for f in frames if f["event"] == "result")
    payload = json.loads(result_frame["data"])
    assert "nodes" in payload
    assert "edges" in payload
    assert "metadata" in payload
    assert len(payload["nodes"]) > 0


def test_stream_progress_phases_are_monotonic(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    percents = [json.loads(f["data"])["percent"] for f in progress_frames]
    for i in range(1, len(percents)):
        assert percents[i] >= percents[i - 1], (
            f"percent not monotonic at index {i}: {percents[i - 1]} → {percents[i]}"
        )


def test_stream_progress_percents_clamped(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    for f in progress_frames:
        pct = json.loads(f["data"])["percent"]
        assert 0 <= pct <= 100, f"percent out of range: {pct}"


def test_stream_progress_has_required_fields(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    for f in [fr for fr in frames if fr["event"] == "progress"]:
        data = json.loads(f["data"])
        assert "phase" in data
        assert "percent" in data
        assert "message" in data


def test_stream_first_progress_is_validating(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    assert progress_frames, "expected at least one progress frame"
    first = json.loads(progress_frames[0]["data"])
    assert first["phase"] == "validating"
    assert first["percent"] == 0


def test_stream_last_progress_is_done(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    last = json.loads(progress_frames[-1]["data"])
    assert last["phase"] == "done"
    assert last["percent"] == 100


def test_stream_phases_sequence_contains_expected_phases(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    phases = [json.loads(f["data"])["phase"] for f in progress_frames]
    for expected in ("validating", "configuring", "invoking", "done"):
        assert expected in phases, f"phase {expected!r} missing from stream"


def test_stream_uses_project_query_param(fixture_project: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    shutil.copytree(fixture_project, other)
    client = _client_for(str(fixture_project), allowed=frozenset({str(other)}))
    frames = _stream_frames(client, f"/erd/stream?project={other}")
    events = [f["event"] for f in frames]
    assert events[-1] == "result"


def test_stream_content_type_is_event_stream(fixture_project: Path) -> None:
    client = _client_for(str(fixture_project))
    with client.stream("GET", "/erd/stream") as response:
        assert "text/event-stream" in response.headers["content-type"]


# ---------------------------------------------------------------------------
# Cache-hit fast path
# ---------------------------------------------------------------------------


def test_stream_cache_hit_emits_done_then_result(fixture_project: Path) -> None:
    cache = ErdCache()
    service = ErdService(default_project_path=str(fixture_project), cache=cache)
    client = TestClient(create_app(service=service))

    # Prime the cache.
    service.build(str(fixture_project))

    frames = _stream_frames(client, "/erd/stream")
    progress_frames = [f for f in frames if f["event"] == "progress"]
    phases = [json.loads(f["data"])["phase"] for f in progress_frames]

    # Cache hit: no invoking / mapping / postprocessing phases — those are skipped.
    assert "invoking" not in phases
    assert "mapping_nodes" not in phases
    assert "mapping_edges" not in phases
    assert "postprocessing" not in phases

    # Terminal done event must be at 100.
    done_events = [p for p in progress_frames if json.loads(p["data"])["phase"] == "done"]
    assert len(done_events) == 1
    assert json.loads(done_events[0]["data"])["percent"] == 100

    # Terminal SSE event must be result.
    events = [f["event"] for f in frames]
    assert events[-1] == "result"


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


def test_stream_emits_error_event_on_missing_manifest(fixture_project: Path) -> None:
    (fixture_project / "target" / "manifest.json").unlink()
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    events = [f["event"] for f in frames]
    assert "error" in events
    error_frame = next(f for f in frames if f["event"] == "error")
    body = json.loads(error_frame["data"])
    assert body["code"] == "manifest_missing"
    assert "manifest.json" in body["detail"]


def test_stream_emits_error_event_on_invalid_project_path(tmp_path: Path) -> None:
    client = _client_for(str(tmp_path / "nope"))
    frames = _stream_frames(client, "/erd/stream")
    events = [f["event"] for f in frames]
    assert "error" in events
    body = json.loads(next(f for f in frames if f["event"] == "error")["data"])
    assert body["code"] == "project_path_invalid"


def test_stream_emits_error_on_missing_project_path(client: TestClient) -> None:
    frames = _stream_frames(client, "/erd/stream")
    events = [f["event"] for f in frames]
    assert "error" in events
    body = json.loads(next(f for f in frames if f["event"] == "error")["data"])
    assert body["code"] == "project_path_missing"


def test_stream_forbidden_on_disallowed_project(fixture_project: Path, tmp_path: Path) -> None:
    other = tmp_path / "other"
    other.mkdir()
    client = _client_for(str(fixture_project))
    with client.stream("GET", f"/erd/stream?project={other}") as response:
        assert response.status_code == 403
        raw = response.read().decode()
    frames = _parse_sse(raw)
    assert frames[0]["event"] == "error"
    body = json.loads(frames[0]["data"])
    assert body["code"] == "project_not_allowed"


def test_stream_error_no_result_event_on_build_failure(fixture_project: Path) -> None:
    (fixture_project / "target" / "manifest.json").unlink()
    client = _client_for(str(fixture_project))
    frames = _stream_frames(client, "/erd/stream")
    assert all(f["event"] != "result" for f in frames)


def test_stream_error_maps_project_path_invalid() -> None:
    """ProjectPathInvalidError → error event with code=project_path_invalid."""
    service = MagicMock(spec=ErdService)
    service.default_project_path = "/fake"
    service.is_allowed.return_value = True
    service.build_with_progress.side_effect = ProjectPathInvalidError("bad path")

    client = TestClient(create_app(service=service))
    frames = _stream_frames(client, "/erd/stream")
    error_frame = next(f for f in frames if f["event"] == "error")
    body = json.loads(error_frame["data"])
    assert body["code"] == "project_path_invalid"


@pytest.mark.parametrize(
    "exc_class,expected_code",
    [
        (ManifestMissingError, "manifest_missing"),
        (ProjectPathMissingError, "project_path_missing"),
        (ConfigInvalidError, "config_invalid"),
    ],
)
def test_stream_error_codes_for_domain_errors(
    exc_class: type, expected_code: str, fixture_project: Path
) -> None:
    """All ErdBuildError subclasses are mapped to the correct error code in the SSE event."""
    service = MagicMock(spec=ErdService)
    service.default_project_path = str(fixture_project)
    service.is_allowed.return_value = True
    service.build_with_progress.side_effect = exc_class("test error")

    client = TestClient(create_app(service=service))
    frames = _stream_frames(client, "/erd/stream")
    error_frame = next(f for f in frames if f["event"] == "error")
    body = json.loads(error_frame["data"])
    assert body["code"] == expected_code
