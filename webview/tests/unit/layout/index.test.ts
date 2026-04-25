import { describe, expect, it } from "vitest";
import { toFlowGraph } from "@/layout";
import type { ErdPayload } from "@/types/erd";

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
        {
          name: "customer_id",
          data_type: "bigint",
          description: null,
          is_primary_key: false,
          is_foreign_key: true,
        },
      ],
      raw_sql_path: "/tmp/orders.sql",
    },
    {
      id: "model.shop.customers",
      name: "customers",
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
      raw_sql_path: null,
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
  metadata: {
    generated_at: "2026-04-18T00:00:00Z",
    dbt_project_name: "shop",
  },
};

describe("toFlowGraph", () => {
  it("maps nodes to xyflow shape and preserves data", () => {
    const graph = toFlowGraph(payload);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].type).toBe("erdTable");
    expect(graph.nodes[0].data.name).toBe("orders");
    // Positions are computed by dagre — don't pin exact values, just assert
    // the nodes don't overlap on either axis.
    const [a, b] = graph.nodes;
    expect(a.position.x !== b.position.x || a.position.y !== b.position.y).toBe(true);
  });

  it("routes edges to column-scoped handles when both columns are known", () => {
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

  it("falls back to table-level handles when a column is absent", () => {
    const bare: ErdPayload = {
      ...payload,
      nodes: payload.nodes.map((n) => ({ ...n, columns: [] })),
    };
    const graph = toFlowGraph(bare);
    expect(graph.edges[0].sourceHandle).toBe("__table_out");
    expect(graph.edges[0].targetHandle).toBe("__table_in");
  });

  it("marks multi-column edges as composite and passes column lists through", () => {
    const composite: ErdPayload = {
      ...payload,
      edges: [
        {
          ...payload.edges[0],
          from_column: "customer_id",
          to_column: "customer_id",
          from_columns: ["customer_id", "segment_code"],
          to_columns: ["customer_id", "segment_code"],
        },
      ],
    };
    const graph = toFlowGraph(composite);
    expect(graph.edges[0].type).toBe("composite");
    expect(graph.edges[0].data).toEqual({
      from_columns: ["customer_id", "segment_code"],
      to_columns: ["customer_id", "segment_code"],
    });
  });

  it("single-column edges remain default (non-composite) edges", () => {
    const single: ErdPayload = {
      ...payload,
      edges: [
        {
          ...payload.edges[0],
          from_columns: ["customer_id"],
          to_columns: ["id"],
        },
      ],
    };
    const graph = toFlowGraph(single);
    expect(graph.edges[0].type).toBeUndefined();
  });

  it("falls back when edge has null column references", () => {
    const nullCols: ErdPayload = {
      ...payload,
      edges: [
        {
          ...payload.edges[0],
          from_column: null,
          to_column: null,
        },
      ],
    };
    const graph = toFlowGraph(nullCols);
    expect(graph.edges[0].sourceHandle).toBe("__table_out");
    expect(graph.edges[0].targetHandle).toBe("__table_in");
  });
});
