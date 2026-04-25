// React Flow node types — kept dagre-free so components can import without
// pulling the layout engine into their dep graph.

import type { Edge, Node } from "@xyflow/react";

import type { ErdNode } from "./erd";

// React Flow v12 requires node data to satisfy `Record<string, unknown>`.
// We intersect rather than editing the auto-generated contract types so
// /sync-contract regeneration stays a clean overwrite.
export type ErdNodeData = ErdNode & Record<string, unknown>;
export type ErdFlowNode = Node<ErdNodeData, "erdTable">;

export interface FlowGraph {
  nodes: ErdFlowNode[];
  edges: Edge[];
}
