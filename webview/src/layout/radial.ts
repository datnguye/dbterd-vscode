// Radial ("star") layout — places high-degree hubs at the centre of a cluster
// and fans their neighbours out in concentric rings. Produces the star /
// snowflake-schema look for fact-and-dimension graphs, where dagre's
// left-to-right ranking collapses low-edge graphs into a tall column.

import type { ErdEdge, ErdNode } from "../types/erd";
import type { TableDimensions } from "./dimensions";
import type { LaidOutNode } from "./dagre";
import {
  buildAdjacency,
  buildDimensions,
  findComponents,
  layoutIslandGrid,
  normalizeToOrigin,
  projectLaidOut,
  splitConnected,
} from "./graph";
import { relaxOverlaps, type Point } from "./overlap";

// Radial gap between successive rings, on top of the widest card's extent.
const RING_GAP = 120;
// Minimum clear space kept between two neighbouring cards on the same ring.
// The ring radius is grown until every card gets this much arc, so a crowded
// hub pushes its satellites outward rather than overlapping them.
const SATELLITE_GAP = 60;
// Horizontal/vertical gap between separate clusters when packed into a grid.
const CLUSTER_GAP = 120;

interface Cluster {
  ids: string[];
  width: number;
  height: number;
  positions: Map<string, Point>;
}

// Lay out one connected component as concentric rings around its highest-degree
// node. Returns local coordinates (top-left origin) plus the component's bbox.
function layoutCluster(
  ids: string[],
  adj: Map<string, Set<string>>,
  dims: Map<string, TableDimensions>,
): Cluster {
  const degree = (id: string): number => adj.get(id)?.size ?? 0;
  const ordered = [...ids].sort((a, b) => degree(b) - degree(a));
  const hub = ordered[0];

  // BFS tree from the hub: each node remembers its parent and depth. Children
  // are placed in a wedge *around their own parent* (not on a global ring), so
  // a satellite sits next to the table it actually connects to — short edges.
  const parent = new Map<string, string | null>([[hub, null]]);
  const depth = new Map<string, number>([[hub, 0]]);
  const children = new Map<string, string[]>();
  const queue = [hub];
  while (queue.length > 0) {
    const id = queue.shift()!;
    // Visit higher-degree neighbours first so dense sub-hubs claim their wedge
    // space early and read as secondary stars.
    const neighbours = [...(adj.get(id) ?? [])].sort((a, b) => degree(b) - degree(a));
    for (const next of neighbours) {
      if (!parent.has(next)) {
        parent.set(next, id);
        depth.set(next, depth.get(id)! + 1);
        const bucket = children.get(id) ?? [];
        bucket.push(next);
        children.set(id, bucket);
        queue.push(next);
      }
    }
  }

  const maxExtent = ids.reduce((max, id) => {
    const d = dims.get(id)!;
    return Math.max(max, d.width, d.height);
  }, 0);
  // Radial distance between a parent and its children's ring.
  const ringStep = maxExtent + RING_GAP;
  // Minimum arc length each node (and its subtree) must reserve so siblings
  // never overlap.
  const arcPerCard = maxExtent + SATELLITE_GAP;

  const local = new Map<string, Point>([[hub, { x: 0, y: 0 }]]);

  // Recursively place a node's children in the angular wedge [angleStart,
  // angleEnd]. Each child's sub-wedge is sized by its subtree's leaf count so
  // bushy branches get proportionally more room. The child is placed at a
  // radius that both clears its parent's ring-step and is far enough out that
  // its own wedge has the arc length to fit its children.
  const leafCount = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) {
      leafCount.set(id, 1);
      return 1;
    }
    const total = kids.reduce((sum, k) => sum + countLeaves(k), 0);
    leafCount.set(id, total);
    return total;
  };
  countLeaves(hub);

  // Ring radius per depth level. Depth 1 must clear the busiest single ring
  // (enough circumference for all of the hub's direct children); deeper levels
  // step out by a fixed ring-step so edges stay roughly one ring long.
  const ringRadius = (d: number): number => {
    const hubChildren = (children.get(hub) ?? []).length;
    const baseCircumference = (hubChildren * arcPerCard) / (2 * Math.PI);
    const base = Math.max(ringStep, baseCircumference);
    return base + (d - 1) * ringStep;
  };

  const place = (id: string, angleStart: number, angleEnd: number): void => {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) return;
    const span = angleEnd - angleStart;
    const totalLeaves = leafCount.get(id)!;
    // All siblings share one radius (a clean ring per parent). Use the larger
    // of the depth ring and the radius this wedge needs so its children each
    // get `arcPerCard` of arc — prevents crowded sub-trees from overlapping
    // while keeping the common case (sparse wedges) at the short depth ring.
    const wedgeRadius = (arcPerCard * kids.length) / Math.max(span, 1e-3);
    const radius = Math.max(ringRadius(depth.get(kids[0])!), wedgeRadius);
    let cursor = angleStart;
    for (const kid of kids) {
      const share = leafCount.get(kid)! / totalLeaves;
      const kidStart = cursor;
      const kidEnd = cursor + span * share;
      const mid = (kidStart + kidEnd) / 2;
      local.set(kid, {
        x: Math.cos(mid) * radius,
        y: Math.sin(mid) * radius,
      });
      place(kid, kidStart, kidEnd);
      cursor = kidEnd;
    }
  };

  // The hub's direct children fan around the full circle; deeper levels recurse
  // inside their parent's wedge.
  place(hub, 0, 2 * Math.PI);

  // Overlap relaxation: the wedge math keeps most cards apart, but two cards in
  // adjacent dense sub-trees can still collide. A few sweeps push any overlapping
  // pair apart along the line between their centres until clear — cheap insurance
  // that guarantees a readable canvas without unwinding the radial structure.
  relaxOverlaps(ids, local, dims, SATELLITE_GAP / 2);

  // Convert centre-coords to top-left and normalise to a (0,0) origin so
  // clusters can be packed; the bbox extent becomes the cluster's footprint.
  const { positions, box } = normalizeToOrigin(ids, local, dims);

  return {
    ids,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    positions,
  };
}

export function runRadialLayout(
  nodes: readonly ErdNode[],
  edges: readonly ErdEdge[],
): LaidOutNode[] {
  const dims = buildDimensions(nodes);

  const adj = buildAdjacency(edges);
  const { connected, islands: islandIds } = splitConnected(
    nodes.map((n) => n.id),
    adj,
  );

  const clusters = findComponents(connected, adj)
    .map((component) => layoutCluster(component, adj, dims))
    // Biggest stars first so the eye lands on the main hub.
    .sort((a, b) => b.ids.length - a.ids.length);

  if (islandIds.length > 0) {
    const grid = layoutIslandGrid(islandIds, dims);
    clusters.push({ ids: islandIds, ...grid });
  }

  // Pack clusters left-to-right, wrapping to a new row when the running width
  // exceeds the widest cluster's footprint scaled out — keeps the canvas closer
  // to square than a single horizontal strip.
  const rowLimit = Math.max(...clusters.map((c) => c.width), 1) * 2 + CLUSTER_GAP;
  const offsets = new Map<string, Point>();
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const cluster of clusters) {
    if (cursorX > 0 && cursorX + cluster.width > rowLimit) {
      cursorX = 0;
      cursorY += rowHeight + CLUSTER_GAP;
      rowHeight = 0;
    }
    for (const id of cluster.ids) {
      const local = cluster.positions.get(id)!;
      offsets.set(id, { x: cursorX + local.x, y: cursorY + local.y });
    }
    cursorX += cluster.width + CLUSTER_GAP;
    rowHeight = Math.max(rowHeight, cluster.height);
  }

  return projectLaidOut(nodes, offsets, dims);
}
