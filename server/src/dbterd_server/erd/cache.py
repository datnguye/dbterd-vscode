"""LRU-bounded cache keyed on (manifest, catalog, config) mtimes."""

from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from dbterd_server.schemas import ErdPayload

# Most users open one or two projects per session. The cap defends against
# long-lived servers that see many distinct project paths (workspace switches)
# from growing memory unboundedly.
DEFAULT_MAX_ENTRIES = 8


@dataclass(frozen=True)
class CacheKey:
    manifest_mtime_ns: int
    catalog_mtime_ns: int  # -1 when catalog is missing
    config_mtime_ns: int  # -1 when no .dbterd.yml / [tool.dbterd] found


@dataclass
class ErdResult:
    payload: ErdPayload
    catalog_missing: bool


def compute_cache_key(
    manifest_file: Path,
    catalog_file: Path | None,
    config_file: Path | None,
) -> CacheKey:
    return CacheKey(
        manifest_mtime_ns=manifest_file.stat().st_mtime_ns,
        catalog_mtime_ns=catalog_file.stat().st_mtime_ns if catalog_file is not None else -1,
        config_mtime_ns=config_file.stat().st_mtime_ns if config_file is not None else -1,
    )


class ErdCache:
    """Per-app cache of `ErdResult`s, keyed by project path + input mtimes."""

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        self._max_entries = max_entries
        self._entries: OrderedDict[str, tuple[CacheKey, ErdResult]] = OrderedDict()

    def get(self, project_path: str, key: CacheKey) -> ErdResult | None:
        entry = self._entries.get(project_path)
        if entry is None or entry[0] != key:
            return None
        self._entries.move_to_end(project_path)
        return entry[1]

    def set(self, project_path: str, key: CacheKey, result: ErdResult) -> None:
        self._entries[project_path] = (key, result)
        self._entries.move_to_end(project_path)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)  # evict least-recently-used

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)
