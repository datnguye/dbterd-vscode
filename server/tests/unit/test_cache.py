from datetime import datetime, timezone

from dbterd_server.erd.cache import CacheKey, ErdCache, ErdResult
from dbterd_server.schemas import ErdMetadata, ErdPayload


def _result(name: str = "p") -> ErdResult:
    return ErdResult(
        payload=ErdPayload(
            nodes=[],
            edges=[],
            metadata=ErdMetadata(
                generated_at=datetime.now(timezone.utc),
                dbt_project_name=name,
            ),
        ),
        catalog_missing=False,
    )


def test_get_returns_none_on_miss() -> None:
    cache = ErdCache()
    assert cache.get("a", CacheKey(1, 1, 1)) is None


def test_get_returns_none_when_key_differs() -> None:
    cache = ErdCache()
    cache.set("a", CacheKey(1, 1, 1), _result())
    assert cache.get("a", CacheKey(2, 1, 1)) is None


def test_set_then_get_round_trips() -> None:
    cache = ErdCache()
    r = _result()
    cache.set("a", CacheKey(1, 1, 1), r)
    assert cache.get("a", CacheKey(1, 1, 1)) is r


def test_evicts_oldest_entry_over_cap() -> None:
    cache = ErdCache(max_entries=2)
    cache.set("a", CacheKey(1, 1, 1), _result("a"))
    cache.set("b", CacheKey(1, 1, 1), _result("b"))
    cache.set("c", CacheKey(1, 1, 1), _result("c"))
    assert len(cache) == 2
    assert cache.get("a", CacheKey(1, 1, 1)) is None
    assert cache.get("b", CacheKey(1, 1, 1)) is not None
    assert cache.get("c", CacheKey(1, 1, 1)) is not None


def test_get_promotes_lru_order() -> None:
    cache = ErdCache(max_entries=2)
    cache.set("a", CacheKey(1, 1, 1), _result("a"))
    cache.set("b", CacheKey(1, 1, 1), _result("b"))
    # Touch "a" — should bump it to the head of the LRU.
    assert cache.get("a", CacheKey(1, 1, 1)) is not None
    cache.set("c", CacheKey(1, 1, 1), _result("c"))
    assert cache.get("b", CacheKey(1, 1, 1)) is None
    assert cache.get("a", CacheKey(1, 1, 1)) is not None


def test_clear_empties_the_cache() -> None:
    cache = ErdCache()
    cache.set("a", CacheKey(1, 1, 1), _result())
    cache.clear()
    assert len(cache) == 0
