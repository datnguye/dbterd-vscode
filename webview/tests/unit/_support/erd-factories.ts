import type { Column, ErdEdge, ErdNode } from "@/types/erd";

const ID_COLUMN: Column = {
  name: "id",
  data_type: "bigint",
  description: null,
  is_primary_key: true,
  is_foreign_key: false,
};

export function node(id: string, name: string = id, columns: Column[] = [ID_COLUMN]): ErdNode {
  return {
    id,
    name,
    resource_type: "model",
    schema_name: "analytics",
    database: "prod",
    columns,
    compiled_sql: null,
  };
}

export function edge(from: string, to: string): ErdEdge {
  return {
    id: `${from}->${to}`,
    from_id: from,
    to_id: to,
    from_column: "id",
    to_column: "id",
    relationship_type: "fk",
  };
}
