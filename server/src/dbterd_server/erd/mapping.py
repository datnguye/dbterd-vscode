"""Pure functions that translate dbterd's json-target dicts into our schema.

dbterd's json target emits the canonical nodes/edges/metadata shape, so these
mappers are close to passthrough — they validate, coerce the
resource/relationship types and cardinality into our literal domains (unknown
values degrade rather than crash, via `coerce_literal`), and derive the singular
primary column pair (`from_column`/`to_column`) the webview's handle-fallback
logic relies on.
"""

import logging
from typing import Any

from dbterd_server.erd.coerce import coerce_literal
from dbterd_server.schemas import (
    Cardinality,
    Column,
    ErdEdge,
    ErdNode,
    RelationshipType,
    ResourceType,
)

_logger = logging.getLogger(__name__)

# The closed literal domains we coerce dbterd's values into. Each pairs with a
# default used when dbterd emits something outside the set (see `coerce_literal`).
_RESOURCE_TYPES: frozenset[ResourceType] = frozenset(("model", "source", "seed", "snapshot"))
_RELATIONSHIP_TYPES: frozenset[RelationshipType] = frozenset(("fk", "lineage"))
_CARDINALITIES: frozenset[Cardinality] = frozenset(("n1", "11", "1n", "nn", ""))


def map_node(node: dict[str, Any]) -> ErdNode:
    columns = [
        Column(
            name=col["name"],
            data_type=col.get("data_type"),
            description=col.get("description") or None,
            is_primary_key=bool(col.get("is_primary_key", False)),
            is_foreign_key=bool(col.get("is_foreign_key", False)),
        )
        for col in (node.get("columns") or [])
    ]
    return ErdNode(
        id=node["id"],
        name=node["name"],
        label=node.get("label") or None,
        description=node.get("description") or None,
        resource_type=coerce_literal(
            node.get("resource_type"), _RESOURCE_TYPES, "model", field="resource_type"
        ),
        schema_name=node.get("schema_name") or None,
        database=node.get("database") or None,
        columns=columns,
        compiled_sql=node.get("compiled_sql") or None,
    )


def map_edge(edge: dict[str, Any]) -> ErdEdge | None:
    from_cols = list(edge.get("from_columns") or [])
    to_cols = list(edge.get("to_columns") or [])
    if not from_cols or not to_cols:
        return None
    if len(from_cols) != len(to_cols):
        # A misaligned edge can't be paired safely — the "primary" pair at
        # index 0 would silently associate unrelated columns. Drop the whole
        # edge and log so the user can investigate the underlying manifest.
        _logger.warning(
            "Skipping edge %s: from_columns (%d) and to_columns (%d) differ in length",
            edge.get("id"),
            len(from_cols),
            len(to_cols),
        )
        return None
    return ErdEdge(
        id=edge["id"],
        from_id=edge["from_id"],
        to_id=edge["to_id"],
        from_column=from_cols[0],
        to_column=to_cols[0],
        from_columns=from_cols,
        to_columns=to_cols,
        relationship_type=coerce_literal(
            edge.get("relationship_type"), _RELATIONSHIP_TYPES, "fk", field="relationship_type"
        ),
        name=edge.get("name") or None,
        label=edge.get("label") or None,
        cardinality=coerce_literal(
            edge.get("cardinality", ""), _CARDINALITIES, "", field="cardinality"
        ),
    )
