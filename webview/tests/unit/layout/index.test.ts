import { describe, expect, it } from "vitest";
import { isLayoutStyle, LAYOUT_STYLES, toFlowGraph } from "@/layout";
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
      compiled_sql: "SELECT id, customer_id FROM orders",
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
      compiled_sql: null,
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

  it("carries column references on single edges so the custom edge can anchor", () => {
    const graph = toFlowGraph(payload);
    expect(graph.edges[0]).toMatchObject({
      id: "e1",
      source: "model.shop.orders",
      target: "model.shop.customers",
      type: "single",
      data: {
        from_column: "customer_id",
        to_column: "id",
        relationship_type: "fk",
      },
    });
    // The custom edge resolves its own side/anchor at render time — no static
    // source/target handle is pinned (that would vanish when a row collapses).
    expect(graph.edges[0].sourceHandle).toBeUndefined();
    expect(graph.edges[0].targetHandle).toBeUndefined();
  });

  it("leaves column references null on single edges when columns are absent", () => {
    const bare: ErdPayload = {
      ...payload,
      nodes: payload.nodes.map((n) => ({ ...n, columns: [] })),
    };
    const graph = toFlowGraph(bare);
    expect(graph.edges[0].type).toBe("single");
    expect(graph.edges[0].data).toMatchObject({
      from_column: "customer_id",
      to_column: "id",
    });
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

  it("single-column edges use the custom single edge type", () => {
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
    expect(graph.edges[0].type).toBe("single");
  });

  it("runs the radial and force engines, not just the default dagre", () => {
    // Each engine must place the two nodes somewhere distinct; this exercises
    // the runLayout dispatch arms for the non-default styles.
    for (const style of ["radial", "force"] as const) {
      const graph = toFlowGraph(payload, style);
      const [a, b] = graph.nodes;
      expect(a.position.x !== b.position.x || a.position.y !== b.position.y).toBe(true);
    }
  });

  it("keeps null column references as null on the single edge", () => {
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
    expect(graph.edges[0].type).toBe("single");
    expect(graph.edges[0].data).toMatchObject({
      from_column: null,
      to_column: null,
    });
  });
});

describe("isLayoutStyle", () => {
  it("accepts every known layout style", () => {
    for (const style of LAYOUT_STYLES) {
      expect(isLayoutStyle(style)).toBe(true);
    }
  });

  it("rejects unknown strings and non-string values", () => {
    expect(isLayoutStyle("tree")).toBe(false);
    expect(isLayoutStyle("")).toBe(false);
    expect(isLayoutStyle(undefined)).toBe(false);
    expect(isLayoutStyle(null)).toBe(false);
    expect(isLayoutStyle(42)).toBe(false);
  });
});
