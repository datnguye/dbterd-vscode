import pytest

from dbterd_server.erd.cardinality import normalize


@pytest.mark.parametrize("value", ["n1", "11", "1n", "nn", ""])
def test_normalize_passes_through_known_values(value: str) -> None:
    assert normalize(value, "ref") == value


def test_normalize_downgrades_unknown_values() -> None:
    assert normalize("weird-value", "fk_x") == ""


def test_normalize_handles_none_ref_name() -> None:
    assert normalize("nope", None) == ""
