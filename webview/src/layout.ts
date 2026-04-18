import type { Edge, Node } from "@xyflow/react";
import type { ErdNode, ErdPayload } from "./types/erd";

// React Flow v12 requires node data to satisfy `Record<string, unknown>`.
// We intersect rather than editing the auto-generated contract types so
// /sync-contract regeneration stays a clean overwrite.
export type ErdNodeData = ErdNode & Record<string, unknown>;
export type ErdFlowNode = Node<ErdNodeData, "erdTable">;

interface FlowGraph {
  nodes: ErdFlowNode[];
  edges: Edge[];
}

const GRID_COLS = 4;
const COL_WIDTH = 320;
const ROW_HEIGHT = 280;

export function toFlowGraph(payload: ErdPayload): FlowGraph {
  const nodes: ErdFlowNode[] = payload.nodes.map((n, idx) => ({
    id: n.id,
    type: "erdTable",
    data: { ...n },
    position: {
      x: (idx % GRID_COLS) * COL_WIDTH,
      y: Math.floor(idx / GRID_COLS) * ROW_HEIGHT,
    },
  }));
  const edges: Edge[] = payload.edges.map((e) => ({
    id: e.id,
    source: e.from_id,
    target: e.to_id,
    sourceHandle: e.from_column ? `${e.from_column}__out` : undefined,
    targetHandle: e.to_column ? `${e.to_column}__in` : undefined,
    animated: e.relationship_type === "fk",
  }));
  return { nodes, edges };
}
