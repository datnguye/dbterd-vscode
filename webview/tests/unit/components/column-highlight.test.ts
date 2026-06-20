import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import { columnsForSelectedEdges } from "@/components/column-highlight";

function edge(over: Partial<Edge>): Edge {
  return { id: "e", source: "a", target: "b", ...over } as Edge;
}

describe("columnsForSelectedEdges", () => {
  it("returns no highlights when nothing is selected", () => {
    const map = columnsForSelectedEdges([
      edge({ data: { from_column: "x", to_column: "y" } }),
    ]);
    expect(map.size).toBe(0);
  });

  it("highlights the single edge's from/to columns on each endpoint", () => {
    const map = columnsForSelectedEdges([
      edge({
        source: "orders",
        target: "customers",
        selected: true,
        data: { from_column: "customer_id", to_column: "id" },
      }),
    ]);
    expect(map.get("orders")).toEqual(new Set(["customer_id"]));
    expect(map.get("customers")).toEqual(new Set(["id"]));
  });

  it("highlights every column of a composite edge", () => {
    const map = columnsForSelectedEdges([
      edge({
        source: "a",
        target: "b",
        selected: true,
        data: { from_columns: ["c1", "c2"], to_columns: ["k1", "k2"] },
      }),
    ]);
    expect(map.get("a")).toEqual(new Set(["c1", "c2"]));
    expect(map.get("b")).toEqual(new Set(["k1", "k2"]));
  });

  it("unions columns when multiple edges touch the same table", () => {
    const map = columnsForSelectedEdges([
      edge({ id: "e1", source: "a", target: "b", selected: true, data: { from_column: "x", to_column: "p" } }),
      edge({ id: "e2", source: "a", target: "c", selected: true, data: { from_column: "y", to_column: "q" } }),
    ]);
    expect(map.get("a")).toEqual(new Set(["x", "y"]));
  });

  it("ignores null column references", () => {
    const map = columnsForSelectedEdges([
      edge({ source: "a", target: "b", selected: true, data: { from_column: null, to_column: null } }),
    ]);
    expect(map.size).toBe(0);
  });
});
