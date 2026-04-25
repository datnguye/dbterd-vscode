"""Thin wrapper around `dbterd.api.DbtErd`.

Resolves the artifacts directory (real or synthetic-when-catalog-missing) and
pre-validates the configured algo so we can map registry misses to a clean
`ErdBuildError` without a broad except.
"""

import json
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from dbterd.api import DbtErd
from dbterd.core.registry.plugin_registry import PluginRegistry

from dbterd_server.erd.errors import ConfigInvalidError

_DEFAULT_ALGO = "test_relationship"


def invoke_dbterd(
    target_dir: Path,
    catalog_missing: bool,
    config: dict[str, Any],
) -> str:
    algo = config.get("algo", _DEFAULT_ALGO)
    if not PluginRegistry.has_algo(algo):
        raise ConfigInvalidError(f"dbterd rejected configuration: unknown algo {algo!r}")
    with _resolved_artifacts_dir(target_dir, catalog_missing) as artifacts_dir:
        kwargs: dict[str, Any] = {"target": "json", **config, "artifacts_dir": str(artifacts_dir)}
        return DbtErd(**kwargs).get_erd()


@contextmanager
def _resolved_artifacts_dir(target_dir: Path, catalog_missing: bool) -> Iterator[Path]:
    if not catalog_missing:
        yield target_dir
        return
    # dbterd's algo needs a catalog.json; without one, parse_artifacts raises
    # deep inside. Stage the real manifest.json alongside a synthetic empty
    # catalog.json in a temp dir and point dbterd there, so the user's target/
    # stays untouched.
    with tempfile.TemporaryDirectory(prefix="dbterd-server-") as tmp:
        tmp_path = Path(tmp)
        os.symlink(target_dir / "manifest.json", tmp_path / "manifest.json")
        (tmp_path / "catalog.json").write_text(_SYNTHETIC_CATALOG_CONTENT)
        yield tmp_path


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
