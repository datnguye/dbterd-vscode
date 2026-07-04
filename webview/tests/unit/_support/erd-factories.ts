import type { Column, ErdEdge, ErdMetadata, ErdNode, ErdPayload } from "@datnguye/erd-flow";

export function column(name: string, overrides: Partial<Column> = {}): Column {
  return {
    name,
    data_type: "bigint",
    description: null,
    is_primary_key: false,
    is_foreign_key: false,
    ...overrides,
  };
}

export function node(id: string, overrides: Partial<ErdNode> = {}): ErdNode {
  return {
    id,
    name: id.split(".").pop() ?? id,
    resource_type: "model",
    schema_name: "s",
    database: "d",
    columns: [column("id")],
    ...overrides,
  };
}

export function edge(from: string, to: string, overrides: Partial<ErdEdge> = {}): ErdEdge {
  return {
    id: `${from}->${to}`,
    from_id: from,
    to_id: to,
    ...overrides,
  };
}

export function payload(
  nodes: ErdNode[],
  edges: ErdEdge[] = [],
  metadata: ErdMetadata = { generated_at: "2026-01-01T00:00:00Z", dbt_project_name: "demo" },
): ErdPayload {
  return { nodes, edges, metadata };
}
