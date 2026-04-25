"""ErdService — wraps cache + builder so routes don't reach into app.state."""

from dbterd_server.erd.builder import build_erd
from dbterd_server.erd.cache import ErdCache, ErdResult


class ErdService:
    """One per app. Holds the cache, validates project paths against allow-list."""

    def __init__(
        self,
        default_project_path: str = "",
        allowed_project_paths: frozenset[str] | None = None,
        cache: ErdCache | None = None,
    ) -> None:
        self._default_project_path = default_project_path
        # Empty allow-list means "only the default is allowed". A None default
        # (server started without --project) means no project is allowed yet.
        self._allowed_project_paths = allowed_project_paths or frozenset()
        self._cache = cache or ErdCache()

    @property
    def default_project_path(self) -> str:
        return self._default_project_path

    @default_project_path.setter
    def default_project_path(self, value: str) -> None:
        self._default_project_path = value

    def is_allowed(self, project_path: str) -> bool:
        if not project_path:
            return False
        if project_path == self._default_project_path:
            return True
        return project_path in self._allowed_project_paths

    def build(self, project_path: str) -> ErdResult:
        return build_erd(project_path, self._cache)

    def clear_cache(self) -> None:
        self._cache.clear()
