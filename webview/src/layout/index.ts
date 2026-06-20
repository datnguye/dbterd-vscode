// Top-level layout orchestration. Glues dagre output to xyflow nodes and
// translates ERD edges into xyflow edges (single-column or composite).

import type { Edge } from "@xyflow/react";

import type { ErdEdge, ErdPayload } from "../types/erd";
import type { ErdFlowNode, FlowGraph } from "../types/flow";
import { runDagreLayout, type LaidOutNode } from "./dagre";
import { runForceLayout } from "./force";
import { runRadialLayout } from "./radial";

export type { ErdFlowNode, ErdNodeData, FlowGraph } from "../types/flow";

// Available canvas arrangements. "hierarchical" is dagre's left-to-right
// ranking; "radial" fans hubs into stars; "force" is a spring simulation that
// settles shared dimensions among their facts (best for star/snowflake
// schemas). Persisted via the webview state API so a reload restores the choice.
// Single source of truth for the set of layout styles and their order. The
// LayoutStyle union, the persisted-state validator (isLayoutStyle), and the
// Toolbar's button list all derive from this one array — adding a layout is a
// single edit here (plus its engine module and a Toolbar icon).
export const LAYOUT_STYLES = ["hierarchical", "radial", "force"] as const;

export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

export const DEFAULT_LAYOUT: LayoutStyle = "radial";

// Narrow an arbitrary persisted/string value to a known LayoutStyle.
export function isLayoutStyle(value: unknown): value is LayoutStyle {
  return typeof value === "string" && (LAYOUT_STYLES as readonly string[]).includes(value);
}

function runLayout(payload: ErdPayload, style: LayoutStyle): LaidOutNode[] {
  if (style === "radial") return runRadialLayout(payload.nodes, payload.edges);
  if (style === "force") return runForceLayout(payload.nodes, payload.edges);
  return runDagreLayout(payload.nodes, payload.edges);
}

export function toFlowGraph(
  payload: ErdPayload,
  style: LayoutStyle = DEFAULT_LAYOUT,
): FlowGraph {
  const positions = runLayout(payload, style);
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

  const edges: Edge[] = payload.edges.map((e) => mapEdge(e));
  return { nodes, edges };
}

function mapEdge(edge: ErdEdge): Edge {
  const fromCol = edge.from_column ?? null;
  const toCol = edge.to_column ?? null;
  const fromCols = edge.from_columns ?? [];
  const toCols = edge.to_columns ?? [];
  const isComposite = fromCols.length > 1 && toCols.length > 1;

  // Both edge kinds render themselves via custom components that read live node
  // geometry — they pick the anchor side per layout (auto side) and fall back to
  // the table-level handle when a referenced column row is collapsed away. We
  // only set source/target (so React Flow validates the endpoints) and hand the
  // column references through `data`; no static sourceHandle/targetHandle, which
  // would otherwise pin the side and vanish on collapse.
  if (isComposite) {
    return {
      id: edge.id,
      source: edge.from_id,
      target: edge.to_id,
      type: "composite",
      data: { from_columns: fromCols, to_columns: toCols },
    };
  }

  return {
    id: edge.id,
    source: edge.from_id,
    target: edge.to_id,
    type: "single",
    data: {
      from_column: fromCol,
      to_column: toCol,
      relationship_type: edge.relationship_type,
    },
  };
}
