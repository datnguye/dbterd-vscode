from datetime import datetime, timezone

from dbterd_server.erd.timestamps import parse_generated_at


def test_parse_generated_at_accepts_iso_zulu() -> None:
    dt = parse_generated_at("2026-04-04T05:08:37.907328Z")
    assert dt.year == 2026
    assert dt.tzinfo is not None


def test_parse_generated_at_falls_back_on_garbage() -> None:
    before = datetime.now(timezone.utc)
    dt = parse_generated_at("not-a-date")
    after = datetime.now(timezone.utc)
    assert before <= dt <= after


def test_parse_generated_at_falls_back_on_empty() -> None:
    assert parse_generated_at("").tzinfo is not None


def test_parse_generated_at_falls_back_on_none() -> None:
    assert parse_generated_at(None).tzinfo is not None
