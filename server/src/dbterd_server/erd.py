import json
import logging
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from dbt_artifacts_parser.parser import parse_catalog, parse_manifest
from dbterd import default

# Import algo modules for their @register_algo side effects — without these,
# PluginRegistry.get_algo("test_relationship" | "model_contract") raises KeyError.
from dbterd.adapters.algos import model_contract as _model_contract_algo
from dbterd.adapters.algos import test_relationship as _test_relationship_algo
from dbterd.adapters.algos.test_relationship import Ref, Table
from dbterd.cli.config import ConfigError, find_config_file, load_config
from dbterd.core.registry.decorators import PluginRegistry

from dbterd_server.schemas import Column, ErdEdge, ErdNode, ErdPayload, ResourceType

_logger = logging.getLogger(__name__)

# Referenced so linters don't strip the side-effect imports above.
_REGISTERED_ALGO_MODULES = (_model_contract_algo, _test_relationship_algo)

_RESOURCE_TYPES: list[ResourceType] = ["model", "source", "seed", "snapshot"]
_KNOWN_CARDINALITIES = frozenset({"n1", "11", "1n", "nn", ""})
# Keys we honor from .dbterd.yml / [tool.dbterd]. Anything else dbterd knows
# about (output format, omit-columns, etc.) is silently ignored — those belong
# to the CLI, not our ERD builder.
_HONORED_CONFIG_KEYS = frozenset(
    {"algo", "entity_name_format", "resource_type", "select", "exclude"}
)


class ErdBuildError(Exception):
    """Raised when the ERD cannot be built — the server maps this to HTTP 4xx."""


class ManifestMissingError(ErdBuildError):
    """target/manifest.json is absent. The user probably hasn't run `dbt compile`."""


@dataclass(frozen=True)
class _CacheKey:
    manifest_mtime_ns: int
    catalog_mtime_ns: int  # -1 when catalog is missing
    config_mtime_ns: int  # -1 when no .dbterd.yml / [tool.dbterd] found


@dataclass
class ErdResult:
    payload: ErdPayload
    catalog_missing: bool


# LRU-bounded cache — most users open one or two projects per session. The cap
# defends against long-lived servers that see many distinct project paths (e.g.
# a workspace switch) from growing memory unboundedly.
_CACHE_MAX_ENTRIES = 8
_cache: OrderedDict[str, tuple[_CacheKey, ErdResult]] = OrderedDict()


def _read_project_name(project_path: Path) -> str:
    project_yml = project_path / "dbt_project.yml"
    if not project_yml.is_file():
        return ""
    try:
        data = yaml.safe_load(project_yml.read_text()) or {}
    except yaml.YAMLError:
        return ""
    name = data.get("name")
    return str(name) if isinstance(name, str) else ""


def _mtime_ns(path: Path) -> int:
    return path.stat().st_mtime_ns


def _map_table(
    table: Table,
    project_path: Path,
    path_by_unique_id: dict[str, str],
) -> ErdNode:
    columns = [
        Column(
            name=col.name,
            data_type=col.data_type,
            description=col.description or None,
            is_primary_key=bool(getattr(col, "is_primary_key", False)),
            is_foreign_key=bool(getattr(col, "is_foreign_key", False)),
        )
        for col in (table.columns or [])
    ]
    raw_sql_path = _resolve_raw_sql_path(table, project_path, path_by_unique_id)
    resource_type: ResourceType = (
        table.resource_type if table.resource_type in _RESOURCE_TYPES else "model"
    )
    # Use table.name as the id, not table.node_name. `Ref.table_map` from dbterd
    # keys refs by `table.name` (which reflects entity_name_format). Using
    # node_name here would desync the graph whenever the user sets
    # entity-name-format != "resource.package.model" and edges would fail to
    # resolve against nodes in the webview.
    return ErdNode(
        id=table.name,
        name=table.name,
        resource_type=resource_type,
        schema_name=table.schema or None,
        database=table.database or None,
        columns=columns,
        raw_sql_path=raw_sql_path,
    )


def _resolve_raw_sql_path(
    table: Table,
    project_path: Path,
    path_by_unique_id: dict[str, str],
) -> str | None:
    # Look up the node's original file path from the manifest (pre-indexed once
    # per build) — O(1) vs the previous O(tree-size) glob per table. Only emit
    # a path if we can confirm it resolves on disk; a broken link is worse than
    # no link.
    node_name = table.node_name or ""
    if not node_name.startswith("model."):
        return None
    relative = path_by_unique_id.get(node_name)
    if not relative:
        return None
    candidate = (project_path / relative).resolve()
    return str(candidate) if candidate.is_file() else None


def _index_manifest_paths(manifest_raw: dict[str, Any]) -> dict[str, str]:
    # Build {unique_id: original_file_path} once per /erd build. The manifest
    # carries this for every node, so we don't need to walk the filesystem.
    index: dict[str, str] = {}
    for unique_id, node in (manifest_raw.get("nodes") or {}).items():
        if not isinstance(node, dict):
            continue
        path = node.get("original_file_path")
        if isinstance(path, str) and path:
            index[unique_id] = path
    return index


def _map_ref(ref: Ref, index: int) -> ErdEdge | None:
    parent, child = ref.table_map
    parent_cols, child_cols = ref.column_map
    if not parent_cols or not child_cols:
        return None
    if len(parent_cols) != len(child_cols):
        # A misaligned ref can't be paired safely — the "primary" pair at
        # index 0 would silently associate unrelated columns. Drop the whole
        # edge and log so the user can investigate the underlying manifest.
        _logger.warning(
            "Skipping ref %s: parent_cols (%d) and child_cols (%d) differ in length",
            ref.name,
            len(parent_cols),
            len(child_cols),
        )
        return None
    if ref.type not in _KNOWN_CARDINALITIES:
        _logger.debug(
            "Unknown cardinality %r on ref %s; downgrading to '' for the webview",
            ref.type,
            ref.name,
        )
    cardinality = ref.type if ref.type in _KNOWN_CARDINALITIES else ""
    return ErdEdge(
        id=f"{ref.name}__{index}",
        from_id=parent,
        to_id=child,
        from_column=parent_cols[0],
        to_column=child_cols[0],
        from_columns=list(parent_cols),
        to_columns=list(child_cols),
        relationship_type="fk",
        name=ref.name or None,
        label=ref.relationship_label or None,
        cardinality=cardinality,  # type: ignore[arg-type]
    )


def build_erd(project_path_str: str) -> ErdResult:
    if not project_path_str:
        raise ErdBuildError("No dbt project path configured.")
    project_path = Path(project_path_str)
    if not project_path.is_dir():
        raise ErdBuildError(f"dbt project path does not exist: {project_path_str}")

    manifest_file = project_path / "target" / "manifest.json"
    catalog_file = project_path / "target" / "catalog.json"
    if not manifest_file.is_file():
        raise ManifestMissingError(
            f"manifest.json not found at {manifest_file}. Run `dbt compile` first."
        )

    catalog_missing = not catalog_file.is_file()
    dbterd_config, config_path = _load_dbterd_config(project_path)
    cache_key = _CacheKey(
        manifest_mtime_ns=_mtime_ns(manifest_file),
        catalog_mtime_ns=-1 if catalog_missing else _mtime_ns(catalog_file),
        config_mtime_ns=_mtime_ns(config_path) if config_path is not None else -1,
    )
    cached = _cache.get(project_path_str)
    if cached is not None and cached[0] == cache_key:
        _cache.move_to_end(project_path_str)
        return cached[1]

    manifest_raw = json.loads(manifest_file.read_text())
    path_by_unique_id = _index_manifest_paths(manifest_raw)
    manifest = parse_manifest(manifest_raw)
    if catalog_missing:
        # Synthesize a minimal empty catalog so dbterd's algo doesn't blow up.
        catalog = parse_catalog(
            {
                "metadata": {
                    "dbt_schema_version": ("https://schemas.getdbt.com/dbt/catalog/v1.json"),
                    "dbt_version": "0.0.0",
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "invocation_id": "dbterd-server",
                    "env": {},
                },
                "nodes": {},
                "sources": {},
                "errors": None,
            }
        )
    else:
        catalog = parse_catalog(json.loads(catalog_file.read_text()))

    algo_kwargs: dict[str, Any] = {
        "select": [],
        "exclude": [],
        "resource_type": _RESOURCE_TYPES,
        "entity_name_format": default.default_entity_name_format(),
        "algo": "test_relationship",
    }
    algo_kwargs.update(dbterd_config)

    algo_name = str(algo_kwargs.get("algo", "test_relationship"))
    try:
        algo_class = PluginRegistry.get_algo(algo_name)
    except KeyError as err:
        raise ErdBuildError(f"Unknown dbterd algo: {algo_name}") from err
    algo = algo_class()
    tables, refs = algo.parse_artifacts(manifest=manifest, catalog=catalog, **algo_kwargs)

    nodes = [_map_table(t, project_path, path_by_unique_id) for t in tables]
    edges: list[ErdEdge] = []
    for i, ref in enumerate(refs):
        mapped = _map_ref(ref, i)
        if mapped is not None:
            edges.append(mapped)
    # Catalog coverage is often partial — a FK column named in a relationships
    # test may not be in the node's column list. Inject synthetic entries so
    # the webview can anchor edges to real column handles instead of falling
    # back to the table border.
    _ensure_ref_columns_exist(nodes, edges)
    # dbterd's catalog-sourced columns never get `is_foreign_key=True` even
    # when they're on the child side of a ref. Flip the flag ourselves —
    # using the full column_map from the Ref, not just the edge's first pair,
    # so composite FKs mark every participating column.
    _mark_foreign_key_columns(nodes, refs)

    payload = ErdPayload(
        nodes=nodes,
        edges=edges,
        generated_at=datetime.now(timezone.utc),
        dbt_project_name=_read_project_name(project_path),
    )
    result = ErdResult(payload=payload, catalog_missing=catalog_missing)
    _cache[project_path_str] = (cache_key, result)
    _cache.move_to_end(project_path_str)
    while len(_cache) > _CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)  # evict least-recently-used
    return result


def _ensure_ref_columns_exist(nodes: list[ErdNode], edges: list[ErdEdge]) -> None:
    index = {node.id: node for node in nodes}
    for edge in edges:
        _inject_column(index.get(edge.from_id), edge.from_column)
        _inject_column(index.get(edge.to_id), edge.to_column)


def _mark_foreign_key_columns(nodes: list[ErdNode], refs: list[Ref]) -> None:
    # Mark only the "child" side of each ref — the columns that hold the
    # reference. Parent columns (typically PKs) stay as-is so they keep the
    # PK badge. Iterates the full column_map so composite FKs cover every
    # participating column, not just the first.
    index = {node.id: node for node in nodes}
    for ref in refs:
        _, child_id = ref.table_map
        _, child_cols = ref.column_map
        node = index.get(child_id)
        if node is None:
            continue
        child_col_set = set(child_cols)
        for col in node.columns:
            if col.name in child_col_set:
                col.is_foreign_key = True


def _inject_column(node: ErdNode | None, column_name: str | None) -> None:
    if node is None or not column_name:
        return
    if any(col.name == column_name for col in node.columns):
        return
    node.columns.append(
        Column(
            name=column_name,
            data_type=None,
            description=None,
            is_primary_key=False,
            is_foreign_key=True,
        )
    )


def _load_dbterd_config(project_path: Path) -> tuple[dict[str, Any], Path | None]:
    """Load and filter the user's .dbterd.yml / [tool.dbterd] config.

    Returns (kwargs-for-parse_artifacts, config-file-path-or-None). The path is
    used for cache invalidation. A malformed config file raises ErdBuildError so
    the user sees the problem in the webview rather than a silent ignore.
    """
    config_path = find_config_file(start_dir=project_path)
    if config_path is None:
        return {}, None
    try:
        raw = load_config(start_dir=project_path)
    except ConfigError as err:
        raise ErdBuildError(f"Invalid dbterd config at {config_path}: {err}") from err
    filtered = {k: v for k, v in raw.items() if k in _HONORED_CONFIG_KEYS}
    return filtered, config_path


def clear_cache() -> None:
    _cache.clear()
