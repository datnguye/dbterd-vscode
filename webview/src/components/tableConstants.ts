// Shared between ErdTableNode (rendering), dimensions.ts (dagre pre-sizing), and
// the FK edge anchor (computing a column's row Y). These are the single source
// of truth for card geometry: ErdTableNode.css pins the matching `height`
// (border-box) values to them, so the anchor's index-based row Y lands exactly
// on the rendered row. Change a value here and update its CSS counterpart in
// lockstep — they are pinned, not merely approximated.

export const COLLAPSE_THRESHOLD = 5;
export const COLLAPSED_VISIBLE = 5;

export function isCollapsible(columnCount: number): boolean {
  return columnCount > COLLAPSE_THRESHOLD;
}

export function visibleColumnCount(columnCount: number, expanded: boolean): number {
  return isCollapsible(columnCount) && !expanded ? COLLAPSED_VISIBLE : columnCount;
}
// `.erd-table-expand` height.
export const COLLAPSE_TOGGLE_HEIGHT = 24;
// `.erd-table-header` height (border-box, incl. its bottom border).
export const HEADER_HEIGHT = 32;
// `.erd-column` height (border-box).
export const COLUMN_HEIGHT = 22;
// `.erd-table-columns` top padding.
export const COLUMNS_TOP_PADDING = 4;
// Minimum card width: the dagre pre-size floor and the edge-anchor's
// pre-measurement fallback both clamp to this so an edge's X lands on the card.
export const MIN_CARD_WIDTH = 220;
