import { describe, expect, it } from "vitest";
import { toFlowGraph } from "./layout";
import type { ErdPayload } from "./types/erd";

const payload: ErdPayload = {
  nodes: [
    {
      id: "model.shop.orders",
      name: "orders",
      resource_type: "model",
      schema_name: "analytics",
      database: "prod",
      columns: [
        {
          name: "id",
          data_type: "bigint",
          description: null,
          is_primary_key: true,
          is_foreign_key: false,
        },
      ],
      raw_sql_path: "/tmp/orders.sql",
    },
  ],
  edges: [
    {
      id: "e1",
      from_id: "model.shop.orders",
      to_id: "model.shop.customers",
      from_column: "customer_id",
      to_column: "id",
      relationship_type: "fk",
    },
  ],
  generated_at: "2026-04-18T00:00:00Z",
  dbt_project_name: "shop",
};

describe("toFlowGraph", () => {
  it("maps nodes to xyflow shape and preserves data", () => {
    const graph = toFlowGraph(payload);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe("erdTable");
    expect(graph.nodes[0].data.name).toBe("orders");
    expect(graph.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("animates FK edges and routes to column-scoped handles", () => {
    const graph = toFlowGraph(payload);
    expect(graph.edges[0]).toMatchObject({
      id: "e1",
      source: "model.shop.orders",
      target: "model.shop.customers",
      sourceHandle: "customer_id__out",
      targetHandle: "id__in",
      animated: true,
    });
  });
});
