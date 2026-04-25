// Dagre adapter — runs hierarchical layout against the payload and returns
// per-node positions converted to xyflow's top-left coordinate system.

import dagre from "@dagrejs/dagre";

import type { ErdEdge, ErdNode } from "../types/erd";
import { estimateDimensions, type TableDimensions } from "./dimensions";

// "LR" = left-to-right hierarchical. For FK ERDs this reads as parent → child
// (referenced → referencing), the conventional direction for schema diagrams.
const LAYOUT_DIRECTION = "LR";
const NODE_SEPARATION = 60;
const RANK_SEPARATION = 120;
const MARGIN = 24;

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  dimensions: TableDimensions;
}

export function runDagreLayout(
  nodes: readonly ErdNode[],
  edges: readonly ErdEdge[],
): LaidOutNode[] {
  const g = new dagre.graphlib.Graph({ compound: false });
  g.setGraph({
    rankdir: LAYOUT_DIRECTION,
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Memoize dimensions so dagre and the position converter agree on the same
  // value — consistency matters more than perf here.
  const dims = new Map<string, TableDimensions>();
  for (const node of nodes) {
    const dim = estimateDimensions(node);
    dims.set(node.id, dim);
    g.setNode(node.id, dim);
  }
  for (const edge of edges) {
    g.setEdge(edge.from_id, edge.to_id);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const dim = dims.get(n.id)!;
    // Dagre reports center-coordinates; xyflow expects top-left. Offset by
    // half-dimensions to convert.
    return {
      id: n.id,
      x: pos.x - dim.width / 2,
      y: pos.y - dim.height / 2,
      dimensions: dim,
    };
  });
}
