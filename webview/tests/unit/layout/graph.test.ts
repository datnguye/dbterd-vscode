import { describe, expect, it } from "vitest";

import {
  buildAdjacency,
  buildDimensions,
  clamp,
  findComponents,
  layoutIslandGrid,
  normalizeToOrigin,
  projectLaidOut,
  splitConnected,
} from "@/layout/graph";
import type { TableDimensions } from "@/layout/dimensions";
import type { Point } from "@/layout/overlap";
import { edge, node } from "../_support/erd-factories";

const dims = (w: number, h: number): TableDimensions => ({ width: w, height: h });

describe("clamp", () => {
  it("bounds a value to [lo, hi]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe("buildDimensions", () => {
  it("estimates one TableDimensions per node, keyed by id", () => {
    const map = buildDimensions([node("a"), node("b")]);
    expect([...map.keys()].sort()).toEqual(["a", "b"]);
    expect(map.get("a")!.width).toBeGreaterThan(0);
    expect(map.get("a")!.height).toBeGreaterThan(0);
  });
});

describe("projectLaidOut", () => {
  it("projects positions to LaidOutNode, defaulting a missing position to origin", () => {
    const nodes = [node("a"), node("b")];
    const d = buildDimensions(nodes);
    const positions = new Map<string, Point>([["a", { x: 10, y: 20 }]]);
    const out = projectLaidOut(nodes, positions, d);
    expect(out[0]).toMatchObject({ id: "a", x: 10, y: 20 });
    expect(out[1]).toMatchObject({ id: "b", x: 0, y: 0 });
    expect(out[0].dimensions).toBe(d.get("a"));
  });
});

describe("buildAdjacency", () => {
  it("builds an undirected map and skips self-loops", () => {
    const adj = buildAdjacency([edge("a", "b"), edge("b", "c"), edge("c", "c")]);
    expect(adj.get("a")).toEqual(new Set(["b"]));
    expect(adj.get("b")).toEqual(new Set(["a", "c"]));
    expect(adj.get("c")).toEqual(new Set(["b"])); // self-loop dropped
  });
});

describe("splitConnected", () => {
  it("separates edge-bearing nodes from islands, preserving input order", () => {
    const adj = buildAdjacency([edge("a", "b")]);
    const { connected, islands } = splitConnected(["a", "island", "b"], adj);
    expect(connected).toEqual(["a", "b"]);
    expect(islands).toEqual(["island"]);
  });
});

describe("findComponents", () => {
  it("returns one non-empty component per connected group", () => {
    const adj = buildAdjacency([edge("a", "b"), edge("c", "d")]);
    const comps = findComponents(["a", "b", "c", "d"], adj);
    expect(comps).toHaveLength(2);
    expect(comps.every((c) => c.length > 0)).toBe(true);
    expect(new Set(comps[0])).toEqual(new Set(["a", "b"]));
  });
});

describe("layoutIslandGrid", () => {
  it("packs ids into rows and reports the packed footprint", () => {
    const d = new Map([
      ["x", dims(100, 50)],
      ["y", dims(100, 50)],
    ]);
    const { positions, width, height } = layoutIslandGrid(["x", "y"], d, 0, 0);
    expect(positions.get("x")).toEqual({ x: 0, y: 0 });
    expect(positions.get("y")!.x).toBeGreaterThan(0); // second column
    expect(width).toBeGreaterThan(0);
    expect(height).toBe(50);
  });
});

describe("normalizeToOrigin", () => {
  it("converts centres to top-left and shifts the block to (0,0)", () => {
    const centres = new Map<string, Point>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 200, y: 0 }],
    ]);
    const d = new Map([
      ["a", dims(100, 100)],
      ["b", dims(100, 100)],
    ]);
    const { positions } = normalizeToOrigin(["a", "b"], centres, d);
    // Left-most card's top-left lands at the origin; both share a row (y=0).
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({ x: 200, y: 0 });
  });
});
