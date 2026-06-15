"""Graceful coercion of dbterd values into our closed literal domains.

dbterd's json target can emit values outside the domains our schema accepts —
a resource_type we don't model, a relationship_type we don't render, a
cardinality the webview can't draw. Letting those reach Pydantic would fail
validation and crash the whole build over one stray field. Instead every such
field funnels through `coerce_literal`, which keeps known values and downgrades
unknown ones to a per-domain default, logging the miss so it's diagnosable.

One helper, one contract: a new degradable field is one `coerce_literal` call
with its allowed set and default.
"""

import logging
from collections.abc import Container
from typing import Any, TypeVar, cast

_logger = logging.getLogger(__name__)

T = TypeVar("T")


def coerce_literal(raw: Any, allowed: Container[T], default: T, *, field: str) -> T:
    """Return `raw` if it's in `allowed`, else `default` (logged at debug).

    `field` names the domain for the log line ("cardinality", "resource_type")
    so an unexpected downgrade is traceable to its source without a stack trace.

    An unhashable `raw` (a list/dict from malformed JSON) can't be a member of a
    set-based domain — testing it would raise `TypeError`. We treat that as just
    another unknown value and degrade, keeping the "never crash" contract.
    """
    try:
        is_known = raw in allowed
    except TypeError:
        is_known = False
    if is_known:
        # Membership in `allowed` is the proof that `raw` is a valid `T`; the
        # cast records that intent (the runtime check already happened above).
        return cast(T, raw)
    _logger.debug("Unknown %s %r; downgrading to %r for the webview", field, raw, default)
    return default
