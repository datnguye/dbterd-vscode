// AUTO-GENERATED from server/src/dbterd_server/schemas.py — do not edit by hand.
// Regenerate with: /sync-contract

export interface Column {
  name: string;
  data_type: string | null;
  description: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
}

export type ResourceType = "model" | "source" | "seed" | "snapshot";

export interface ErdNode {
  id: string;
  name: string;
  resource_type: ResourceType;
  schema_name: string | null;
  database: string | null;
  columns: Column[];
  raw_sql_path: string | null;
}

export interface ErdEdge {
  id: string;
  from_id: string;
  to_id: string;
  from_column: string | null;
  to_column: string | null;
  relationship_type: "fk" | "lineage";
}

export interface ErdPayload {
  nodes: ErdNode[];
  edges: ErdEdge[];
  generated_at: string;
  dbt_project_name: string;
}
