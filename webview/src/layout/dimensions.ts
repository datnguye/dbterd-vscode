// Estimated table card dimensions fed to dagre. We can't measure real
// rendered sizes before layout runs, so we approximate by header + per-column
// row height. Dagre uses these to space nodes without overlap.

import {
  COLLAPSE_THRESHOLD,
  COLLAPSED_VISIBLE,
  COLLAPSE_TOGGLE_HEIGHT,
} from "../components/tableConstants";
import type { Column, ErdNode } from "../types/erd";

const MIN_TABLE_WIDTH = 220;
const MAX_TABLE_WIDTH = 440;
// Visual budget per character; tuned against the ErdTableNode CSS (12px
// monospace column name + 10px muted type + PK/FK badge column).
const CHAR_WIDTH = 7;
const TABLE_HORIZONTAL_PADDING = 60;
const HEADER_HEIGHT = 32;
const COLUMN_HEIGHT = 22;
const MIN_TABLE_HEIGHT = 80;

export interface TableDimensions {
  width: number;
  height: number;
}

export function estimateWidth(node: ErdNode): number {
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

export function estimateHeight(node: ErdNode): number {
  const total = node.columns.length;
  const visible = total > COLLAPSE_THRESHOLD ? COLLAPSED_VISIBLE : total;
  const toggleExtra = total > COLLAPSE_THRESHOLD ? COLLAPSE_TOGGLE_HEIGHT : 0;
  return Math.max(MIN_TABLE_HEIGHT, HEADER_HEIGHT + visible * COLUMN_HEIGHT + toggleExtra);
}

export function estimateDimensions(node: ErdNode): TableDimensions {
  return { width: estimateWidth(node), height: estimateHeight(node) };
}
