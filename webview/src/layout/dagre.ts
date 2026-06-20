// Dagre adapter — runs hierarchical layout against the payload and returns
// per-node positions converted to xyflow's top-left coordinate system.

import dagre from "@dagrejs/dagre";

import type { ErdEdge, ErdNode } from "../types/erd";
import type { TableDimensions } from "./dimensions";
import { buildDimensions, centreToTopLeft } from "./graph";

// "LR" = left-to-right hierarchical. dbterd's json target orders edges
// from_id = FK holder (child / referencing) → to_id = referenced (parent),
// so the diagram reads referencing → referenced left-to-right.
const LAYOUT_DIRECTION = "LR";
const NODE_SEPARATION = 40;
const RANK_SEPARATION = 80;
const MARGIN = 24;
// network-simplex assigns ranks that minimise total edge length (tighter than
// the default longest-path), and "UL" aligns nodes to the upper-left of their
// rank so ranks read as balanced rows rather than centre-spread fans.
const RANKER = "network-simplex";
const NODE_ALIGN = "UL";

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
    ranker: RANKER,
    align: NODE_ALIGN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const dims = buildDimensions(nodes);
  for (const node of nodes) {
    g.setNode(node.id, dims.get(node.id)!);
  }
  for (const edge of edges) {
    g.setEdge(edge.from_id, edge.to_id);
  }
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    const dim = dims.get(n.id)!;
    const { x, y } = centreToTopLeft(pos, dim);
    return { id: n.id, x, y, dimensions: dim };
  });
}
