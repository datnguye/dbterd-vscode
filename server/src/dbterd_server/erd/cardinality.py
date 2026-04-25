import logging

from dbterd_server.schemas import Cardinality

_logger = logging.getLogger(__name__)

# dbterd's Ref.type domain. Anything outside this set we downgrade to "" so the
# webview never sees a value it can't render.
KNOWN_CARDINALITIES = frozenset({"n1", "11", "1n", "nn", ""})


def normalize(ref_type: str, ref_name: str | None) -> Cardinality:
    if ref_type in KNOWN_CARDINALITIES:
        return ref_type  # type: ignore[return-value]
    _logger.debug(
        "Unknown cardinality %r on ref %s; downgrading to '' for the webview",
        ref_type,
        ref_name,
    )
    return ""
