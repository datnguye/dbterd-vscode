// Top-level layout orchestration. Glues dagre output to xyflow nodes and
// translates ERD edges into xyflow edges (single-column or composite).

import type { Edge } from "@xyflow/react";

import type { ErdEdge, ErdPayload } from "../types/erd";
import type { ErdFlowNode, FlowGraph } from "../types/flow";
import { runDagreLayout } from "./dagre";
import {
  buildColumnIndex,
  hasHandle,
  inHandle,
  outHandle,
  TABLE_IN,
  TABLE_OUT,
} from "./handles";

export type { ErdFlowNode, ErdNodeData, FlowGraph } from "../types/flow";

function norm(value: string | null | undefined): string | null {
  return value ?? null;
}

export function toFlowGraph(payload: ErdPayload): FlowGraph {
  const positions = runDagreLayout(payload.nodes, payload.edges);
  const positionsById = new Map(positions.map((p) => [p.id, p]));

  const nodes: ErdFlowNode[] = payload.nodes.map((n) => {
    const pos = positionsById.get(n.id)!;
    return {
      id: n.id,
      type: "erdTable",
      data: { ...n },
      position: { x: pos.x, y: pos.y },
    };
  });

  const columnIndex = buildColumnIndex(payload.nodes);
  const edges: Edge[] = payload.edges.map((e) => mapEdge(e, columnIndex));
  return { nodes, edges };
}

function mapEdge(edge: ErdEdge, columnIndex: Map<string, Set<string>>): Edge {
  const fromCol = norm(edge.from_column);
  const toCol = norm(edge.to_column);
  const fromCols = edge.from_columns ?? [];
  const toCols = edge.to_columns ?? [];
  const isComposite = fromCols.length > 1 && toCols.length > 1;

  if (isComposite) {
    // Composite edges render themselves (per-column tails + bundled middle)
    // via the custom `composite` edge type. We still set source/target and
    // handles so React Flow validates the endpoints, but the visual path is
    // painted entirely by CompositeEdge.tsx.
    return {
      id: edge.id,
      source: edge.from_id,
      target: edge.to_id,
      sourceHandle: hasHandle(columnIndex, edge.from_id, fromCols[0])
        ? outHandle(fromCols[0])
        : TABLE_OUT,
      targetHandle: hasHandle(columnIndex, edge.to_id, toCols[0])
        ? inHandle(toCols[0])
        : TABLE_IN,
      type: "composite",
      data: { from_columns: fromCols, to_columns: toCols },
    };
  }

  return {
    id: edge.id,
    source: edge.from_id,
    target: edge.to_id,
    sourceHandle: hasHandle(columnIndex, edge.from_id, fromCol) ? outHandle(fromCol!) : TABLE_OUT,
    targetHandle: hasHandle(columnIndex, edge.to_id, toCol) ? inHandle(toCol!) : TABLE_IN,
    animated: edge.relationship_type === "fk",
  };
}
