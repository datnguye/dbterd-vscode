import { describe, expect, it } from "vitest";
import { estimateDimensions } from "@/layout/dimensions";
import { runForceLayout } from "@/layout/force";
import type { ErdNode } from "@/types/erd";
import { edge, node } from "../_support/erd-factories";

function countOverlaps(out: ReturnType<typeof runForceLayout>, nodes: ErdNode[]): number {
  const dims = new Map(nodes.map((n) => [n.id, estimateDimensions(n)]));
  const boxes = out.map((p) => ({
    x: p.x,
    y: p.y,
    w: dims.get(p.id)!.width,
    h: dims.get(p.id)!.height,
  }));
  let overlaps = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) overlaps++;
    }
  }
  return overlaps;
}

describe("runForceLayout", () => {
  it("positions every node", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id, id));
    const edges = [edge("a", "b"), edge("b", "c")];
    const out = runForceLayout(nodes, edges);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((p) => p.id))).toEqual(new Set(["a", "b", "c"]));
  });

  it("settles a shared dimension between its facts (short edges all round)", () => {
    // dim is referenced by four facts — a force layout pulls it to the centre so
    // none of its four edges sprawls (the case a tree/radial layout can't fix).
    const facts = ["f1", "f2", "f3", "f4"];
    const nodes = ["dim", ...facts].map((id) => node(id, id));
    const edges = facts.map((f) => edge(f, "dim"));

    const out = runForceLayout(nodes, edges);
    const dims = new Map(nodes.map((n) => [n.id, estimateDimensions(n)]));
    const pos = new Map(out.map((p) => [p.id, p]));
    const centre = (id: string): { x: number; y: number } => {
      const p = pos.get(id)!;
      const d = dims.get(id)!;
      return { x: p.x + d.width / 2, y: p.y + d.height / 2 };
    };
    const dimC = centre("dim");
    const lengths = facts.map((f) => {
      const c = centre(f);
      return Math.hypot(c.x - dimC.x, c.y - dimC.y);
    });
    // No single edge is wildly longer than the others — the dim is roughly
    // equidistant from its facts rather than flung to one side.
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    expect(max / min).toBeLessThan(2.5);
    expect(countOverlaps(out, nodes)).toBe(0);
  });

  it("packs disconnected island tables into a grid block, not a column", () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`, `n${i}`));
    const out = runForceLayout(nodes, []);
    expect(out).toHaveLength(8);
    const xs = new Set(out.map((n) => Math.round(n.x)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("leaves no overlaps on a dense hub", () => {
    const sats = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const nodes = ["hub", ...sats].map((id) => node(id, id));
    const edges = sats.map((s) => edge(s, "hub"));
    const out = runForceLayout(nodes, edges);
    expect(countOverlaps(out, nodes)).toBe(0);
  });

  it("is deterministic for the same input", () => {
    const nodes = ["a", "b", "c"].map((id) => node(id, id));
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(runForceLayout(nodes, edges)).toEqual(runForceLayout(nodes, edges));
  });
});
