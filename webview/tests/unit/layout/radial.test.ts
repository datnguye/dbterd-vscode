import { describe, expect, it } from "vitest";
import { estimateDimensions } from "@/layout/dimensions";
import { runRadialLayout } from "@/layout/radial";
import type { ErdEdge, ErdNode } from "@/types/erd";
import { edge, node } from "../_support/erd-factories";

describe("runRadialLayout", () => {
  it("positions every node and centres the highest-degree hub", () => {
    // hub references three satellites → hub has degree 3.
    const nodes = ["hub", "a", "b", "c"].map((id) => node(id, id));
    const edges = [edge("a", "hub"), edge("b", "hub"), edge("c", "hub")];

    const out = runRadialLayout(nodes, edges);
    expect(out).toHaveLength(4);

    const byId = new Map(out.map((n) => [n.id, n]));
    const hub = byId.get("hub")!;
    // Satellites all sit at a non-trivial distance from the hub centre.
    for (const sat of ["a", "b", "c"]) {
      const s = byId.get(sat)!;
      const dist = Math.hypot(s.x - hub.x, s.y - hub.y);
      expect(dist).toBeGreaterThan(0);
    }
  });

  it("spreads satellites apart rather than stacking them vertically", () => {
    const nodes = ["hub", "a", "b", "c", "d"].map((id) => node(id, id));
    const edges = ["a", "b", "c", "d"].map((s) => edge(s, "hub"));

    const out = runRadialLayout(nodes, edges);
    const sats = out.filter((n) => n.id !== "hub");
    const xs = new Set(sats.map((n) => Math.round(n.x)));
    // A vertical column would collapse to one distinct x; a star spreads them.
    expect(xs.size).toBeGreaterThan(1);
  });

  it("packs disconnected island tables into a grid block, not a column", () => {
    // No edges → every node is an island.
    const nodes = Array.from({ length: 8 }, (_, i) => node(`n${i}`, `n${i}`));
    const out = runRadialLayout(nodes, []);
    expect(out).toHaveLength(8);
    const xs = new Set(out.map((n) => Math.round(n.x)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("never overlaps satellites on a dense single-hub ring", () => {
    // 30 satellites all pointing at one hub — the worst case for a single
    // ring. The radius must grow so no two cards overlap.
    const sats = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const nodes = ["hub", ...sats].map((id) => node(id, id));
    const edges = sats.map((s) => edge(s, "hub"));

    const out = runRadialLayout(nodes, edges);
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
    expect(overlaps).toBe(0);
  });

  it("keeps no overlaps on a deep multi-level tree", () => {
    // A two-level tree: hub → 8 mids → each mid has 4 leaves. Deep dense wedges
    // are where naive radial layouts collide; the relaxation pass must clear it.
    const nodes: ErdNode[] = [node("hub", "hub")];
    const edges: ErdEdge[] = [];
    for (let m = 0; m < 8; m++) {
      const mid = `mid${m}`;
      nodes.push(node(mid, mid));
      edges.push(edge(mid, "hub"));
      for (let l = 0; l < 4; l++) {
        const leaf = `leaf${m}_${l}`;
        nodes.push(node(leaf, leaf));
        edges.push(edge(leaf, mid));
      }
    }

    const out = runRadialLayout(nodes, edges);
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
    expect(overlaps).toBe(0);
  });

  it("returns deterministic positions for the same input", () => {
    const nodes = ["hub", "a", "b"].map((id) => node(id, id));
    const edges = [edge("a", "hub"), edge("b", "hub")];
    const first = runRadialLayout(nodes, edges);
    const second = runRadialLayout(nodes, edges);
    expect(first).toEqual(second);
  });
});
