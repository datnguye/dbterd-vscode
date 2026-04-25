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
from dbterd_server.erd.mapping import map_ref, map_table
from dbterd_server.erd.postprocess import ensure_ref_columns_exist, mark_foreign_key_columns
from dbterd_server.erd.timestamps import parse_generated_at
from dbterd_server.schemas import ErdEdge, ErdMetadata, ErdPayload

# Phase markers — surfaced verbatim in the extension's progress notification
# (which tails this log file). dbterd itself is opaque between manifest read
# and result, so without these the popup would freeze on a stale message for
# the entire dbterd run on big projects.
_logger = logging.getLogger(__name__)


def build_erd(project_path_str: str, cache: ErdCache) -> ErdResult:
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
        return cached

    _logger.info("[parse] invoking dbterd (this can take a while on large projects)…")
    erd_json = invoke_dbterd(target_dir, catalog_missing, dbterd_config)
    _logger.info("[parse] building ERD payload from dbterd output")
    result = _result_from_payload(erd_json, project_path, catalog_missing)
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


def _result_from_payload(erd_json: str, project_path: Path, catalog_missing: bool) -> ErdResult:
    payload_dict = json.loads(erd_json)
    tables = payload_dict.get("tables") or []
    refs = payload_dict.get("relationships") or []
    metadata = payload_dict.get("metadata") or {}

    nodes = [map_table(t, project_path) for t in tables]
    edges: list[ErdEdge] = []
    for i, ref in enumerate(refs):
        mapped = map_ref(ref, i)
        if mapped is not None:
            edges.append(mapped)
    # Catalog coverage is often partial — a FK column named in a relationships
    # test may not be in the node's column list. Inject synthetic entries so
    # the webview can anchor edges to real column handles instead of falling
    # back to the table border.
    ensure_ref_columns_exist(nodes, edges)
    # dbterd's catalog-sourced columns never get is_foreign_key=True even
    # when they're on the child side of a ref. Flip the flag ourselves —
    # using the full column_map from the Ref, not just the edge's first pair,
    # so composite FKs mark every participating column.
    mark_foreign_key_columns(nodes, refs)

    payload = ErdPayload(
        nodes=nodes,
        edges=edges,
        metadata=ErdMetadata(
            generated_at=parse_generated_at(metadata.get("generated_at")),
            dbt_project_name=str(metadata.get("project_name") or ""),
        ),
    )
    return ErdResult(payload=payload, catalog_missing=catalog_missing)
