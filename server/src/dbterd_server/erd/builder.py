"""Top-level ERD orchestration. Thin glue around the focused sub-modules."""

import json
import logging
from pathlib import Path

from dbterd_server.erd.cache import ErdCache, ErdResult, compute_cache_key
from dbterd_server.erd.config import load_dbterd_config
from dbterd_server.erd.dbterd_client import invoke_dbterd
from dbterd_server.erd.errors import (
    ManifestMissingError,
    ProjectPathInvalidError,
    ProjectPathMissingError,
)
from dbterd_server.erd.mapping import map_edge, map_node
from dbterd_server.erd.postprocess import postprocess
from dbterd_server.erd.progress import OnProgress, ProgressReporter, _interpolate
from dbterd_server.erd.timestamps import parse_generated_at
from dbterd_server.schemas import ErdMetadata, ErdPayload
from dbterd_server.schemas.erd import ErdProgress

# Top-level keys in manifest.json that may contain dbt nodes with original_file_path.
_MANIFEST_NODE_SECTIONS = ("nodes", "sources")

# Phase markers — surfaced verbatim in the extension's progress notification
# (which tails this log file). dbterd itself is opaque between manifest read
# and result, so without these the popup would freeze on a stale message for
# the entire dbterd run on big projects.
_logger = logging.getLogger(__name__)


def build_erd(
    project_path_str: str,
    cache: ErdCache,
    on_progress: OnProgress | None = None,
) -> ErdResult:
    reporter = ProgressReporter(on_progress)
    reporter.emit_point("validating", "validating project path")
    _logger.info("[parse] validating project path %s", project_path_str)
    project_path = _validate_project_path(project_path_str)
    target_dir = project_path / "target"
    manifest_file = target_dir / "manifest.json"
    catalog_file = target_dir / "catalog.json"
    if not manifest_file.is_file():
        raise ManifestMissingError(
            f"manifest.json not found at {manifest_file}. Run `dbt compile` first."
        )

    catalog_missing = not catalog_file.is_file()
    reporter.emit_point("configuring", "reading dbterd config")
    _logger.info(
        "[parse] reading dbterd config (catalog %s)",
        "missing" if catalog_missing else "present",
    )
    dbterd_config, config_path = load_dbterd_config(project_path)
    cache_key = compute_cache_key(
        manifest_file=manifest_file,
        catalog_file=None if catalog_missing else catalog_file,
        config_file=config_path,
    )
    cached = cache.get(project_path_str, cache_key)
    if cached is not None:
        _logger.info("[parse] cache hit — skipping dbterd")
        n = len(cached.payload.nodes)
        m = len(cached.payload.edges)
        reporter.emit_point("done", f"done — {n} nodes, {m} edges")
        return cached

    reporter.emit_point("invoking", "invoking dbterd…")
    _logger.info("[parse] invoking dbterd (this can take a while on large projects)…")
    erd_json = invoke_dbterd(target_dir, catalog_missing, dbterd_config)
    reporter.emit("invoking", 65, "dbterd returned")
    _logger.info("[parse] building ERD payload from dbterd output")
    original_file_paths = _load_original_file_paths(manifest_file)
    result = _result_from_payload(
        erd_json, catalog_missing, project_path, original_file_paths, reporter
    )
    cache.set(project_path_str, cache_key, result)
    _logger.info(
        "[parse] done — %d nodes, %d edges", len(result.payload.nodes), len(result.payload.edges)
    )
    return result


def _validate_project_path(project_path_str: str) -> Path:
    if not project_path_str:
        raise ProjectPathMissingError("No dbt project path configured.")
    project_path = Path(project_path_str)
    if not project_path.is_dir():
        raise ProjectPathInvalidError(f"dbt project path does not exist: {project_path_str}")
    return project_path


def _load_original_file_paths(manifest_file: Path) -> dict[str, str]:
    """Return a mapping of unique_id → original_file_path from the manifest.

    Reads only the sections that hold dbt nodes with an original_file_path field.
    Returns an empty dict on any parse failure so that the main build can proceed
    without model_path rather than crash.
    """
    try:
        manifest = json.loads(manifest_file.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    result: dict[str, str] = {}
    for section in _MANIFEST_NODE_SECTIONS:
        for unique_id, node in (manifest.get(section) or {}).items():
            path = node.get("original_file_path")
            if isinstance(path, str) and path:
                result[unique_id] = path
    return result


def _result_from_payload(
    erd_json: str,
    catalog_missing: bool,
    project_path: Path,
    original_file_paths: dict[str, str],
    reporter: ProgressReporter,
) -> ErdResult:
    payload_dict = json.loads(erd_json)
    raw_nodes = payload_dict.get("nodes") or []
    raw_edges = payload_dict.get("edges") or []
    metadata = payload_dict.get("metadata") or {}

    n_nodes = len(raw_nodes)
    n_edges = len(raw_edges)
    nodes = []
    for i, raw_node in enumerate(raw_nodes):
        nodes.append(map_node(raw_node, project_path, original_file_paths))
        reporter.report_mapping("mapping_nodes", i + 1, n_nodes, "nodes")

    # map_edge returns None for empty/misaligned column maps; drop those.
    edges = []
    for i, raw_edge in enumerate(raw_edges):
        edge = map_edge(raw_edge)
        if edge is not None:
            edges.append(edge)
        reporter.report_mapping("mapping_edges", i + 1, n_edges, "edges")

    reporter.emit_point("postprocessing", "post-processing")
    # Catalog coverage is often partial — an FK column named in a relationships
    # test may not be in the node's column list. Inject synthetic entries so the
    # webview can anchor edges to real column handles instead of falling back to
    # the table border.
    postprocess(nodes, edges)

    payload = ErdPayload(
        nodes=nodes,
        edges=edges,
        metadata=ErdMetadata(
            generated_at=parse_generated_at(metadata.get("generated_at")),
            dbt_project_name=str(metadata.get("dbt_project_name") or ""),
        ),
    )
    n = len(nodes)
    m = len(edges)
    reporter.emit_point("done", f"done — {n} nodes, {m} edges")
    return ErdResult(payload=payload, catalog_missing=catalog_missing)


# Re-export for backward-compatibility with tests that import from builder
# (test_builder_progress.py imports _emit and _mapping_percent by name).
# These thin wrappers preserve the observable contract: same signature, same
# behaviour, delegate to progress.py internals.


def _emit(on_progress: OnProgress | None, phase: str, percent: int, message: str) -> None:
    ProgressReporter(on_progress).emit(phase, percent, message)


def _mapping_percent(start: int, end: int, index: int, total: int) -> int:
    return _interpolate(start, end, index, total)


__all__ = [
    "build_erd",
    "OnProgress",
    "ErdProgress",
    "_emit",
    "_mapping_percent",
]
