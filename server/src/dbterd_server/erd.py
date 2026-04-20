import json
import logging
import os
import sys
import tempfile
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from dbterd.api import DbtErd

from dbterd_server.schemas import Column, ErdEdge, ErdNode, ErdPayload, ResourceType

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - Python < 3.11 fallback
    import tomli as tomllib

_logger = logging.getLogger(__name__)

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


def _mtime_ns(path: Path) -> int:
    return path.stat().st_mtime_ns


def _map_table(
    table: dict[str, Any],
    project_path: Path,
) -> ErdNode:
    columns = [
        Column(
            name=col["name"],
            data_type=col.get("data_type"),
            description=col.get("description") or None,
            is_primary_key=bool(col.get("is_primary_key", False)),
            is_foreign_key=False,  # set later by _mark_foreign_key_columns
        )
        for col in (table.get("columns") or [])
    ]
    raw_sql_path = _resolve_raw_sql_path(table, project_path)
    rt_raw = table.get("resource_type")
    resource_type: ResourceType = rt_raw if rt_raw in _RESOURCE_TYPES else "model"
    # Use table["name"] as the id, not node_name. The JSON target uses
    # table.name (which reflects entity_name_format) as the key, and edges
    # reference it — using node_name here would desync the graph whenever the
    # user sets entity-name-format != "resource.package.model".
    return ErdNode(
        id=table["name"],
        name=table["name"],
        resource_type=resource_type,
        schema_name=table.get("schema") or None,
        database=table.get("database") or None,
        columns=columns,
        raw_sql_path=raw_sql_path,
    )


def _resolve_raw_sql_path(table: dict[str, Any], project_path: Path) -> str | None:
    # Only models have compiled SQL we care about. original_file_path comes
    # straight from the manifest via our JSON target; verify it resolves on
    # disk because a broken link is worse than no link.
    if table.get("resource_type") != "model":
        return None
    relative = table.get("original_file_path")
    if not isinstance(relative, str) or not relative:
        return None
    candidate = (project_path / relative).resolve()
    return str(candidate) if candidate.is_file() else None


def _map_ref(ref: dict[str, Any], index: int) -> ErdEdge | None:
    parent, child = ref["table_map"]
    parent_cols, child_cols = ref["column_map"]
    if not parent_cols or not child_cols:
        return None
    if len(parent_cols) != len(child_cols):
        # A misaligned ref can't be paired safely — the "primary" pair at
        # index 0 would silently associate unrelated columns. Drop the whole
        # edge and log so the user can investigate the underlying manifest.
        _logger.warning(
            "Skipping ref %s: parent_cols (%d) and child_cols (%d) differ in length",
            ref.get("name"),
            len(parent_cols),
            len(child_cols),
        )
        return None
    ref_type = ref.get("type", "")
    if ref_type not in _KNOWN_CARDINALITIES:
        _logger.debug(
            "Unknown cardinality %r on ref %s; downgrading to '' for the webview",
            ref_type,
            ref.get("name"),
        )
    cardinality = ref_type if ref_type in _KNOWN_CARDINALITIES else ""
    return ErdEdge(
        id=f"{ref.get('name') or 'ref'}__{index}",
        from_id=parent,
        to_id=child,
        from_column=parent_cols[0],
        to_column=child_cols[0],
        from_columns=list(parent_cols),
        to_columns=list(child_cols),
        relationship_type="fk",
        name=ref.get("name") or None,
        label=ref.get("relationship_label") or None,
        cardinality=cardinality,  # type: ignore[arg-type]
    )


def build_erd(project_path_str: str) -> ErdResult:
    if not project_path_str:
        raise ErdBuildError("No dbt project path configured.")
    project_path = Path(project_path_str)
    if not project_path.is_dir():
        raise ErdBuildError(f"dbt project path does not exist: {project_path_str}")

    target_dir = project_path / "target"
    manifest_file = target_dir / "manifest.json"
    catalog_file = target_dir / "catalog.json"
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

    erd_json = _invoke_dbterd(target_dir, catalog_missing, dbterd_config)
    payload_dict = json.loads(erd_json)

    tables = payload_dict.get("tables") or []
    refs = payload_dict.get("relationships") or []
    metadata = payload_dict.get("metadata") or {}

    nodes = [_map_table(t, project_path) for t in tables]
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
    # dbterd's catalog-sourced columns never get is_foreign_key=True even
    # when they're on the child side of a ref. Flip the flag ourselves —
    # using the full column_map from the Ref, not just the edge's first pair,
    # so composite FKs mark every participating column.
    _mark_foreign_key_columns(nodes, refs)

    payload = ErdPayload(
        nodes=nodes,
        edges=edges,
        generated_at=_parse_generated_at(metadata.get("generated_at")),
        dbt_project_name=str(metadata.get("project_name") or ""),
    )
    result = ErdResult(payload=payload, catalog_missing=catalog_missing)
    _cache[project_path_str] = (cache_key, result)
    _cache.move_to_end(project_path_str)
    while len(_cache) > _CACHE_MAX_ENTRIES:
        _cache.popitem(last=False)  # evict least-recently-used
    return result


def _invoke_dbterd(
    target_dir: Path,
    catalog_missing: bool,
    config: dict[str, Any],
) -> str:
    kwargs: dict[str, Any] = {"target": "json"}
    kwargs.update(config)
    if catalog_missing:
        # dbterd's algo needs a catalog.json; without one, parse_artifacts
        # raises deep inside. Stage the real manifest.json alongside a
        # synthetic empty catalog.json in a temp dir and point dbterd there,
        # so the user's target/ stays untouched.
        with tempfile.TemporaryDirectory(prefix="dbterd-server-") as tmp:
            tmp_path = Path(tmp)
            os.symlink(target_dir / "manifest.json", tmp_path / "manifest.json")
            (tmp_path / "catalog.json").write_text(_SYNTHETIC_CATALOG_CONTENT)
            kwargs["artifacts_dir"] = str(tmp_path)
            return _run_dbterd(kwargs)
    kwargs["artifacts_dir"] = str(target_dir)
    return _run_dbterd(kwargs)


def _run_dbterd(kwargs: dict[str, Any]) -> str:
    try:
        return DbtErd(**kwargs).get_erd()
    except (KeyError, LookupError) as err:
        raise ErdBuildError(f"dbterd rejected configuration: {err}") from err


_SYNTHETIC_CATALOG_CONTENT = json.dumps(
    {
        "metadata": {
            "dbt_schema_version": "https://schemas.getdbt.com/dbt/catalog/v1.json",
            "dbt_version": "0.0.0",
            "generated_at": "1970-01-01T00:00:00Z",
            "invocation_id": "dbterd-server",
            "env": {},
        },
        "nodes": {},
        "sources": {},
        "errors": None,
    }
)


def _parse_generated_at(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            # dbt emits trailing 'Z' which Python's fromisoformat handles on 3.11+.
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _ensure_ref_columns_exist(nodes: list[ErdNode], edges: list[ErdEdge]) -> None:
    index = {node.id: node for node in nodes}
    for edge in edges:
        _inject_column(index.get(edge.from_id), edge.from_column)
        _inject_column(index.get(edge.to_id), edge.to_column)


def _mark_foreign_key_columns(nodes: list[ErdNode], refs: list[dict[str, Any]]) -> None:
    # Mark only the child side of each ref — the columns that hold the
    # reference. Parent columns (typically PKs) stay as-is so they keep the
    # PK badge. Iterates the full column_map so composite FKs cover every
    # participating column, not just the first.
    index = {node.id: node for node in nodes}
    for ref in refs:
        table_map = ref.get("table_map") or [None, None]
        column_map = ref.get("column_map") or [[], []]
        if len(table_map) < 2 or len(column_map) < 2:
            continue
        child_id = table_map[1]
        child_cols = column_map[1] or []
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

    Returns (kwargs-for-DbtErd, config-file-path-or-None). The path is used
    for cache invalidation. A malformed config raises ErdBuildError so the
    user sees the problem in the webview rather than a silent ignore.
    """
    yml_path = project_path / ".dbterd.yml"
    if yml_path.is_file():
        return _load_yaml_config(yml_path), yml_path
    pyproject = project_path / "pyproject.toml"
    if pyproject.is_file():
        cfg = _load_pyproject_config(pyproject)
        if cfg is not None:
            return cfg, pyproject
    return {}, None


def _load_yaml_config(path: Path) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except yaml.YAMLError as err:
        raise ErdBuildError(f"Invalid dbterd config at {path}: {err}") from err
    if not isinstance(raw, dict):
        return {}
    return _normalize_config(raw)


def _load_pyproject_config(path: Path) -> dict[str, Any] | None:
    try:
        data = tomllib.loads(path.read_text())
    except tomllib.TOMLDecodeError as err:
        raise ErdBuildError(f"Invalid dbterd config at {path}: {err}") from err
    section = data.get("tool", {}).get("dbterd")
    if not isinstance(section, dict):
        return None
    return _normalize_config(section)


def _normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    # Config keys use kebab-case ("entity-name-format") but DbtErd expects
    # snake_case kwargs. Translate then filter.
    translated = {k.replace("-", "_"): v for k, v in raw.items()}
    return {k: v for k, v in translated.items() if k in _HONORED_CONFIG_KEYS}


def clear_cache() -> None:
    _cache.clear()
