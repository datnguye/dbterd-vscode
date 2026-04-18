from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ResourceType = Literal["model", "source", "seed", "snapshot"]
RelationshipType = Literal["fk", "lineage"]
# dbterd's Ref.type: "n1" (many-to-one), "11" (one-to-one), "1n", "nn", "".
Cardinality = Literal["n1", "11", "1n", "nn", ""]


class Column(BaseModel):
    name: str
    data_type: str | None = None
    description: str | None = None
    is_primary_key: bool = False
    is_foreign_key: bool = False


class ErdNode(BaseModel):
    id: str
    name: str
    resource_type: ResourceType
    schema_name: str | None = None
    database: str | None = None
    columns: list[Column]
    raw_sql_path: str | None = None


class ErdEdge(BaseModel):
    id: str
    from_id: str
    to_id: str
    # Primary column pair — preserved for the webview's handle-fallback logic
    # and for single-column FKs. For composite FKs, `from_columns`/`to_columns`
    # carry the full list and the webview renders a bundled composite edge.
    from_column: str | None = None
    to_column: str | None = None
    from_columns: list[str] = []
    to_columns: list[str] = []
    relationship_type: RelationshipType = "fk"
    # Constraint name (dbterd Ref.name), e.g. "fk_order_to_location".
    name: str | None = None
    # Friendly label from `meta.relationship_labels` in schema.yml.
    label: str | None = None
    cardinality: Cardinality = ""


class ErdPayload(BaseModel):
    nodes: list[ErdNode]
    edges: list[ErdEdge]
    generated_at: datetime
    dbt_project_name: str


class HealthStatus(BaseModel):
    status: Literal["ok"]
