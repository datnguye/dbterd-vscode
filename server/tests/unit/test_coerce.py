import logging

import pytest

from dbterd_server.erd.coerce import coerce_literal

_ALLOWED = frozenset(("a", "b", ""))


@pytest.mark.parametrize("value", ["a", "b", ""])
def test_passes_through_known_values(value: str) -> None:
    assert coerce_literal(value, _ALLOWED, "a", field="thing") == value


@pytest.mark.parametrize("bad", ["nope", None, 0, "weird-value"])
def test_downgrades_unknown_values_to_default(bad: object) -> None:
    assert coerce_literal(bad, _ALLOWED, "a", field="thing") == "a"


@pytest.mark.parametrize("unhashable", [[], {}, ["a"]])
def test_unhashable_input_degrades_instead_of_raising(unhashable: object) -> None:
    # A list/dict from malformed JSON can't be a set member; the membership test
    # would raise TypeError. The helper must swallow it and degrade.
    assert coerce_literal(unhashable, _ALLOWED, "a", field="thing") == "a"


def test_logs_the_downgrade_at_debug(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG, logger="dbterd_server.erd.coerce"):
        coerce_literal("nope", _ALLOWED, "a", field="cardinality")
    assert "cardinality" in caplog.text
    assert "nope" in caplog.text


def test_known_value_does_not_log(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG, logger="dbterd_server.erd.coerce"):
        coerce_literal("a", _ALLOWED, "a", field="thing")
    assert caplog.text == ""
