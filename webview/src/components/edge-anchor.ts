// Shared anchor resolution for the custom FK edges (single + composite).
//
// An endpoint anchors on the FK column's row, computed from the column's index
// in the *currently rendered* list — not from React Flow's handle bounds, which
// only exist for visible rows and lag re-measurement. A column hidden under the
// "N more" collapse anchors at the collapse boundary (just below the last
// visible row), so its edge stays on the card edge instead of piling onto a
// single table-level handle. The X is the card's left or right edge by side.

import type { CSSProperties } from "react";
import type { useInternalNode } from "@xyflow/react";

import {
  COLUMN_HEIGHT,
  COLUMNS_TOP_PADDING,
  HEADER_HEIGHT,
  MIN_CARD_WIDTH,
  visibleColumnCount,
} from "./tableConstants";
import type { Point } from "./composite-edge/geometry";

export interface AnchorNode {
  // Absolute top-left of the card on the canvas.
  base: Point;
  width: number;
  // Column name → its index in the card's render order. A Map (not indexOf over
  // an array) keeps each row-anchor lookup O(1) even on wide fact tables that
  // every edge endpoint re-anchors on each pan/zoom render.
  columnIndex: ReadonlyMap<string, number>;
  // Total column count, including rows hidden under the "N more" collapse.
  columnCount: number;
  // Whether the card is currently expanded (all rows shown).
  expanded: boolean;
}

// Build the shared AnchorNode view of a React Flow internal node. Used by both
// the single- and composite-column FK edges so the two stay in lockstep.
export function anchorNodeOf(node: ReturnType<typeof useInternalNode>): AnchorNode | null {
  if (!node) return null;
  const columns = (node.data?.columns ?? []) as { name: string }[];
  const columnIndex = new Map<string, number>();
  columns.forEach((c, i) => {
    if (!columnIndex.has(c.name)) columnIndex.set(c.name, i);
  });
  return {
    base: node.internals.positionAbsolute,
    width: node.measured?.width ?? node.width ?? MIN_CARD_WIDTH,
    columnIndex,
    columnCount: columns.length,
    expanded: node.data?.__expanded === true,
  };
}

// Y (within the card) of a visible row's vertical centre.
function rowCenterY(rowIndex: number): number {
  return HEADER_HEIGHT + COLUMNS_TOP_PADDING + rowIndex * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;
}

// The row index a column anchors to: its own row if visible, else the last
// visible row (the collapse boundary) so hidden columns share the card edge
// just above the "N more" toggle rather than stacking on one point.
function anchorRowIndex(node: AnchorNode, column: string | null): number {
  const visibleCount = visibleColumnCount(node.columnCount, node.expanded);
  const idx = column ? (node.columnIndex.get(column) ?? -1) : -1;
  if (idx >= 0 && idx < visibleCount) return idx;
  return Math.max(0, visibleCount - 1);
}

// Resolve one endpoint to an absolute anchor on the FK column's row. `sideIsLeft`
// selects the card's left vs right vertical edge (the in/out handle side).
export function resolveAnchor(
  node: AnchorNode,
  column: string | null,
  sideIsLeft: boolean,
): Point {
  const x = sideIsLeft ? node.base.x : node.base.x + node.width;
  return { x, y: node.base.y + rowCenterY(anchorRowIndex(node, column)) };
}

export interface EndpointSides {
  fromIsLeft: boolean;
  toIsLeft: boolean;
}

export function endpointSides(from: AnchorNode, to: AnchorNode): EndpointSides {
  const fromOnLeft = from.base.x <= to.base.x;
  return { fromIsLeft: !fromOnLeft, toIsLeft: fromOnLeft };
}

export function fkStrokeStyle(selected: boolean, style?: CSSProperties): CSSProperties {
  return {
    stroke: selected
      ? "var(--vscode-charts-yellow, #e5c07b)"
      : "var(--vscode-focusBorder, #007acc)",
    strokeWidth: selected ? 3 : 2,
    fill: "none",
    ...style,
  };
}
