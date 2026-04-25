"""Loader for the user's `.dbterd.yml` / `[tool.dbterd]` config.

A malformed config raises `ErdBuildError` so the user sees the problem in the
webview rather than a silent ignore. Unknown keys are dropped — they belong to
the dbterd CLI (output format, omit-columns, etc.), not our ERD builder.
"""

import sys
from pathlib import Path
from typing import Any

import yaml

from dbterd_server.erd.errors import ConfigInvalidError

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - Python < 3.11 fallback
    import tomli as tomllib

# Keys we honor. Anything else dbterd knows about is silently ignored.
HONORED_CONFIG_KEYS = frozenset(
    {"algo", "entity_name_format", "resource_type", "select", "exclude"}
)


def load_dbterd_config(project_path: Path) -> tuple[dict[str, Any], Path | None]:
    """Return (kwargs-for-DbtErd, config-file-path-or-None).

    The path is used for cache invalidation.
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
        raise ConfigInvalidError(f"Invalid dbterd config at {path}: {err}") from err
    if not isinstance(raw, dict):
        return {}
    return _normalize_config(raw)


def _load_pyproject_config(path: Path) -> dict[str, Any] | None:
    try:
        data = tomllib.loads(path.read_text())
    except tomllib.TOMLDecodeError as err:
        raise ConfigInvalidError(f"Invalid dbterd config at {path}: {err}") from err
    section = data.get("tool", {}).get("dbterd")
    if not isinstance(section, dict):
        return None
    return _normalize_config(section)


def _normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    # Config keys use kebab-case ("entity-name-format") but DbtErd expects
    # snake_case kwargs. Translate then filter.
    translated = {k.replace("-", "_"): v for k, v in raw.items()}
    return {k: v for k, v in translated.items() if k in HONORED_CONFIG_KEYS}
