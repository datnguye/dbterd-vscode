from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ResourceType = Literal["model", "source", "seed", "snapshot"]
RelationshipType = Literal["fk", "lineage"]


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
    from_column: str | None = None
    to_column: str | None = None
    relationship_type: RelationshipType = "fk"


class ErdPayload(BaseModel):
    nodes: list[ErdNode]
    edges: list[ErdEdge]
    generated_at: datetime
    dbt_project_name: str


class HealthStatus(BaseModel):
    status: Literal["ok"]
