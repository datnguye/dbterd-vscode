// Shared graph + geometry helpers for the layout engines. The radial and force
// engines both need the same primitives — an undirected adjacency map, the
// connected/island split, connected-component discovery, an island grid packer,
// and a centre-to-top-left bounding-box normalisation. They live here (beside
// `overlap.ts`) so the engines compose them rather than each carrying a copy.

import type { LaidOutNode } from "./dagre";
import type { ErdEdge, ErdNode } from "../types/erd";
import { estimateDimensions, type TableDimensions } from "./dimensions";
import type { Point } from "./overlap";

// Default island-grid packing knobs. The engines pass their own gap where they
// want a different rhythm; the column count is shared.
export const ISLAND_COLUMNS = 6;
export const ISLAND_GAP = 40;

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function buildDimensions(nodes: readonly ErdNode[]): Map<string, TableDimensions> {
  const dims = new Map<string, TableDimensions>();
  for (const node of nodes) dims.set(node.id, estimateDimensions(node));
  return dims;
}

// Convert a single centre coordinate to xyflow's top-left, the one place the
// half-dimension offset lives so every engine shares it.
export function centreToTopLeft(centre: Point, dim: TableDimensions): Point {
  return { x: centre.x - dim.width / 2, y: centre.y - dim.height / 2 };
}

export function projectLaidOut(
  nodes: readonly ErdNode[],
  positions: Map<string, Point>,
  dims: Map<string, TableDimensions>,
): LaidOutNode[] {
  return nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    return { id: n.id, x: pos.x, y: pos.y, dimensions: dims.get(n.id)! };
  });
}

// Undirected neighbour map over the FK edges. Self-loops are skipped — they
// carry no positioning information and would inflate a node's degree. Typed on
// just the endpoint fields so callers holding React Flow edges (source/target)
// can reuse it without a full ErdEdge.
export function buildAdjacency(
  edges: readonly Pick<ErdEdge, "from_id" | "to_id">[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    const set = adj.get(a) ?? new Set<string>();
    set.add(b);
    adj.set(a, set);
  };
  for (const edge of edges) {
    if (edge.from_id === edge.to_id) continue;
    link(edge.from_id, edge.to_id);
    link(edge.to_id, edge.from_id);
  }
  return adj;
}

// Split node ids into those that participate in at least one edge ("connected",
// in adjacency order-stable input order) and the degree-0 "islands".
export function splitConnected(
  ids: readonly string[],
  adj: Map<string, Set<string>>,
): { connected: string[]; islands: string[] } {
  const connected: string[] = [];
  const islands: string[] = [];
  for (const id of ids) {
    (adj.has(id) ? connected : islands).push(id);
  }
  return { connected, islands };
}

// Connected components via BFS over the undirected adjacency map. Every returned
// component is non-empty (each BFS seeds with its start node).
export function findComponents(
  ids: readonly string[],
  adj: Map<string, Set<string>>,
): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const start of ids) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const component: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

// Pack ids into a left-to-right grid that wraps after ISLAND_COLUMNS, anchored
// at (originX, originY). Returns top-left positions plus the packed bbox.
export function layoutIslandGrid(
  ids: readonly string[],
  dims: Map<string, TableDimensions>,
  originX = 0,
  originY = 0,
  gap = ISLAND_GAP,
): { positions: Map<string, Point>; width: number; height: number } {
  const positions = new Map<string, Point>();
  const colWidth =
    ids.reduce((max, id) => Math.max(max, dims.get(id)!.width), 0) + gap;
  let rowY = originY;
  let rowHeight = 0;
  let totalWidth = 0;
  ids.forEach((id, i) => {
    const col = i % ISLAND_COLUMNS;
    if (col === 0 && i > 0) {
      rowY += rowHeight + gap;
      rowHeight = 0;
    }
    const d = dims.get(id)!;
    positions.set(id, { x: originX + col * colWidth, y: rowY });
    rowHeight = Math.max(rowHeight, d.height);
    totalWidth = Math.max(totalWidth, col * colWidth + d.width);
  });
  return { positions, width: totalWidth, height: rowY + rowHeight - originY };
}

// Convert centre coordinates to top-left and translate the whole block so its
// bounding box starts at (0,0). Returns the new positions and the *pre-shift*
// bbox (callers use its extent to place the next block).
export function normalizeToOrigin(
  ids: readonly string[],
  centres: Map<string, Point>,
  dims: Map<string, TableDimensions>,
): { positions: Map<string, Point>; box: BoundingBox } {
  const positions = new Map<string, Point>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const c = centres.get(id) ?? { x: 0, y: 0 };
    const d = dims.get(id)!;
    const { x, y } = centreToTopLeft(c, d);
    positions.set(id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + d.width);
    maxY = Math.max(maxY, y + d.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  for (const [id, pos] of positions) {
    positions.set(id, { x: pos.x - minX, y: pos.y - minY });
  }
  return { positions, box: { minX, minY, maxX, maxY } };
}
