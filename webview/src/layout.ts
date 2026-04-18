import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import {
  COLLAPSE_THRESHOLD,
  COLLAPSED_VISIBLE,
  COLLAPSE_TOGGLE_HEIGHT,
} from "./components/tableConstants";
import type { Column, ErdNode, ErdPayload } from "./types/erd";

// React Flow v12 requires node data to satisfy `Record<string, unknown>`.
// We intersect rather than editing the auto-generated contract types so
// /sync-contract regeneration stays a clean overwrite.
export type ErdNodeData = ErdNode & Record<string, unknown>;
export type ErdFlowNode = Node<ErdNodeData, "erdTable">;

interface FlowGraph {
  nodes: ErdFlowNode[];
  edges: Edge[];
}

// Estimated table card dimensions fed to dagre. We can't measure real
// rendered sizes before layout runs, so we approximate by header + per-column
// row height. Dagre uses these to space nodes without overlap.
const MIN_TABLE_WIDTH = 220;
const MAX_TABLE_WIDTH = 440;
// Visual budget per character; tuned against the ErdTableNode CSS (12px
// monospace column name + 10px muted type + PK/FK badge column).
const CHAR_WIDTH = 7;
const TABLE_HORIZONTAL_PADDING = 60;
const HEADER_HEIGHT = 32;
const COLUMN_HEIGHT = 22;
const MIN_TABLE_HEIGHT = 80;

// "LR" = left-to-right hierarchical. For FK ERDs this reads as parent → child
// (referenced → referencing), the conventional direction for schema diagrams.
const LAYOUT_DIRECTION = "LR";
const NODE_SEPARATION = 60;
const RANK_SEPARATION = 120;

function estimateWidth(node: ErdNode): number {
  // Longest "column — type" line drives the card width. Length is capped so
  // a single absurdly-long column name doesn't blow out the layout.
  const contentLen = (col: Column): number =>
    col.name.length + (col.data_type ? col.data_type.length + 2 : 0);
  const longest = node.columns.reduce(
    (max, c) => Math.max(max, contentLen(c)),
    node.name.length,
  );
  const raw = longest * CHAR_WIDTH + TABLE_HORIZONTAL_PADDING;
  return Math.min(MAX_TABLE_WIDTH, Math.max(MIN_TABLE_WIDTH, raw));
}

function estimateHeight(node: ErdNode): number {
  const total = node.columns.length;
  const visible = total > COLLAPSE_THRESHOLD ? COLLAPSED_VISIBLE : total;
  const toggleExtra = total > COLLAPSE_THRESHOLD ? COLLAPSE_TOGGLE_HEIGHT : 0;
  return Math.max(MIN_TABLE_HEIGHT, HEADER_HEIGHT + visible * COLUMN_HEIGHT + toggleExtra);
}

function norm(value: string | null | undefined): string | null {
  return value ?? null;
}

export function toFlowGraph(payload: ErdPayload): FlowGraph {
  const g = new dagre.graphlib.Graph({ compound: false });
  g.setGraph({
    rankdir: LAYOUT_DIRECTION,
    nodesep: NODE_SEPARATION,
    ranksep: RANK_SEPARATION,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Memoize width/height so dagre and the position-converter agree on the
  // same value (estimateWidth/Height are cheap but not free — and consistency
  // matters more than perf here).
  const dims = new Map<string, { width: number; height: number }>();
  for (const node of payload.nodes) {
    const dim = { width: estimateWidth(node), height: estimateHeight(node) };
    dims.set(node.id, dim);
    g.setNode(node.id, dim);
  }
  for (const edge of payload.edges) {
    g.setEdge(edge.from_id, edge.to_id);
  }
  dagre.layout(g);

  const nodes: ErdFlowNode[] = payload.nodes.map((n) => {
    const pos = g.node(n.id);
    const dim = dims.get(n.id)!;
    return {
      id: n.id,
      type: "erdTable",
      data: { ...n },
      // Dagre reports center-coordinates; xyflow expects top-left. Offset by
      // half-dimensions to convert.
      position: {
        x: pos.x - dim.width / 2,
        y: pos.y - dim.height / 2,
      },
    };
  });

  const columnsByNode = new Map(
    payload.nodes.map((n) => [n.id, new Set(n.columns.map((c) => c.name))]),
  );
  const hasHandle = (nodeId: string, column: string | null): boolean =>
    !!column && (columnsByNode.get(nodeId)?.has(column) ?? false);

  const edges: Edge[] = payload.edges.map((e) => {
    const fromCol = norm(e.from_column);
    const toCol = norm(e.to_column);
    const fromCols = e.from_columns ?? [];
    const toCols = e.to_columns ?? [];
    const isComposite = fromCols.length > 1 && toCols.length > 1;

    if (isComposite) {
      // Composite edges render themselves (per-column tails + bundled middle)
      // via the custom `composite` edge type. We still set source/target and
      // handles so React Flow validates the endpoints, but the visual path is
      // painted entirely by CompositeEdge.tsx.
      return {
        id: e.id,
        source: e.from_id,
        target: e.to_id,
        sourceHandle: hasHandle(e.from_id, fromCols[0]) ? `${fromCols[0]}__out` : "__table_out",
        targetHandle: hasHandle(e.to_id, toCols[0]) ? `${toCols[0]}__in` : "__table_in",
        type: "composite",
        data: { from_columns: fromCols, to_columns: toCols },
      };
    }

    return {
      id: e.id,
      source: e.from_id,
      target: e.to_id,
      sourceHandle: hasHandle(e.from_id, fromCol) ? `${fromCol}__out` : "__table_out",
      targetHandle: hasHandle(e.to_id, toCol) ? `${toCol}__in` : "__table_in",
      animated: e.relationship_type === "fk",
    };
  });
  return { nodes, edges };
}
