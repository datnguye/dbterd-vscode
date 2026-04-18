// AUTO-GENERATED from server/src/dbterd_server/schemas.py — do not edit by hand.\n// Regenerate with: task sync-contract

export type Id = string;
export type Name = string;
export type ResourceType = "model" | "source" | "seed" | "snapshot";
export type SchemaName = string | null;
export type Database = string | null;
export type Name1 = string;
export type DataType = string | null;
export type Description = string | null;
export type IsPrimaryKey = boolean;
export type IsForeignKey = boolean;
export type Columns = Column[];
export type RawSqlPath = string | null;
export type Nodes = ErdNode[];
export type Id1 = string;
export type FromId = string;
export type ToId = string;
export type FromColumn = string | null;
export type ToColumn = string | null;
export type FromColumns = string[];
export type ToColumns = string[];
export type RelationshipType = "fk" | "lineage";
export type Name2 = string | null;
export type Label = string | null;
export type Cardinality = "n1" | "11" | "1n" | "nn" | "";
export type Edges = ErdEdge[];
export type GeneratedAt = string;
export type DbtProjectName = string;

export interface ErdPayload {
  nodes: Nodes;
  edges: Edges;
  generated_at: GeneratedAt;
  dbt_project_name: DbtProjectName;
  [k: string]: unknown;
}
export interface ErdNode {
  id: Id;
  name: Name;
  resource_type: ResourceType;
  schema_name?: SchemaName;
  database?: Database;
  columns: Columns;
  raw_sql_path?: RawSqlPath;
  [k: string]: unknown;
}
export interface Column {
  name: Name1;
  data_type?: DataType;
  description?: Description;
  is_primary_key?: IsPrimaryKey;
  is_foreign_key?: IsForeignKey;
  [k: string]: unknown;
}
export interface ErdEdge {
  id: Id1;
  from_id: FromId;
  to_id: ToId;
  from_column?: FromColumn;
  to_column?: ToColumn;
  from_columns?: FromColumns;
  to_columns?: ToColumns;
  relationship_type?: RelationshipType;
  name?: Name2;
  label?: Label;
  cardinality?: Cardinality;
  [k: string]: unknown;
}
