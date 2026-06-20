import { describe, expect, it } from "vitest";

import {
  anchorNodeOf,
  endpointSides,
  fkStrokeStyle,
  resolveAnchor,
  type AnchorNode,
} from "@/components/edge-anchor";
import {
  COLLAPSED_VISIBLE,
  COLUMN_HEIGHT,
  COLUMNS_TOP_PADDING,
  HEADER_HEIGHT,
} from "@/components/tableConstants";

// Build a node whose column count exceeds the collapse threshold.
function node(overrides: Partial<AnchorNode> = {}): AnchorNode {
  const columns = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const columnIndex = new Map(columns.map((name, i) => [name, i]));
  return {
    base: { x: 100, y: 200 },
    width: 220,
    columnIndex,
    columnCount: columns.length,
    expanded: false,
    ...overrides,
  };
}

function rowCenterY(rowIndex: number): number {
  return HEADER_HEIGHT + COLUMNS_TOP_PADDING + rowIndex * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;
}

describe("resolveAnchor", () => {
  it("anchors a visible column on its row, right edge", () => {
    const p = resolveAnchor(node(), "c2", false);
    expect(p).toEqual({ x: 100 + 220, y: 200 + rowCenterY(2) });
  });

  it("anchors on the left edge when sideIsLeft", () => {
    const p = resolveAnchor(node(), "c2", true);
    expect(p).toEqual({ x: 100, y: 200 + rowCenterY(2) });
  });

  it("anchors a hidden column at the collapse boundary (last visible row)", () => {
    // c9 is past COLLAPSED_VISIBLE while collapsed → boundary row.
    const p = resolveAnchor(node({ expanded: false }), "c9", false);
    expect(p).toEqual({ x: 320, y: 200 + rowCenterY(COLLAPSED_VISIBLE - 1) });
  });

  it("anchors that same column on its own row once expanded", () => {
    const p = resolveAnchor(node({ expanded: true }), "c9", false);
    expect(p).toEqual({ x: 320, y: 200 + rowCenterY(9) });
  });

  it("falls back to the collapse boundary for an unknown / null column", () => {
    const boundary = 200 + rowCenterY(COLLAPSED_VISIBLE - 1);
    expect(resolveAnchor(node(), null, false).y).toEqual(boundary);
    expect(resolveAnchor(node(), "nope", false).y).toEqual(boundary);
  });
});

// Minimal stand-in for xyflow's InternalNode — only the fields anchorNodeOf reads.
type InternalNodeLike = Parameters<typeof anchorNodeOf>[0];
function internalNode(overrides: Partial<{
  columns: { name: string }[];
  measured?: { width?: number };
  width?: number;
  expanded: boolean;
  position: { x: number; y: number };
}> = {}): InternalNodeLike {
  const { columns = [{ name: "a" }, { name: "b" }], expanded = false, position = { x: 5, y: 9 } } =
    overrides;
  return {
    data: { columns, __expanded: expanded },
    measured: overrides.measured,
    width: overrides.width,
    internals: { positionAbsolute: position },
  } as unknown as InternalNodeLike;
}

describe("anchorNodeOf", () => {
  it("returns null for a missing node", () => {
    expect(anchorNodeOf(undefined)).toBeNull();
  });

  it("indexes columns by name and counts them", () => {
    const a = anchorNodeOf(internalNode({ columns: [{ name: "x" }, { name: "y" }, { name: "z" }] }))!;
    expect(a.columnCount).toBe(3);
    expect(a.columnIndex.get("y")).toBe(1);
    expect(a.columnIndex.get("z")).toBe(2);
  });

  it("keeps the first index on a duplicate column name", () => {
    const a = anchorNodeOf(internalNode({ columns: [{ name: "dup" }, { name: "dup" }] }))!;
    expect(a.columnIndex.get("dup")).toBe(0);
  });

  it("prefers the measured width, then width, then the fallback", () => {
    expect(anchorNodeOf(internalNode({ measured: { width: 300 }, width: 250 }))!.width).toBe(300);
    expect(anchorNodeOf(internalNode({ width: 250 }))!.width).toBe(250);
    expect(anchorNodeOf(internalNode({}))!.width).toBe(220);
  });

  it("coerces __expanded to a strict boolean and reads the absolute position", () => {
    const a = anchorNodeOf(internalNode({ expanded: true, position: { x: 11, y: 22 } }))!;
    expect(a.expanded).toBe(true);
    expect(a.base).toEqual({ x: 11, y: 22 });
  });
});

describe("endpointSides", () => {
  const at = (x: number): AnchorNode => node({ base: { x, y: 0 } });

  it("anchors the left-positioned card on its right edge and vice versa", () => {
    expect(endpointSides(at(0), at(500))).toEqual({ fromIsLeft: false, toIsLeft: true });
    expect(endpointSides(at(500), at(0))).toEqual({ fromIsLeft: true, toIsLeft: false });
  });

  it("breaks an exact-X tie consistently (from right, to left)", () => {
    expect(endpointSides(at(100), at(100))).toEqual({ fromIsLeft: false, toIsLeft: true });
  });
});

describe("fkStrokeStyle", () => {
  it("uses the focus colour at width 2 when not selected", () => {
    expect(fkStrokeStyle(false)).toMatchObject({
      stroke: "var(--vscode-focusBorder, #007acc)",
      strokeWidth: 2,
      fill: "none",
    });
  });

  it("uses the highlight colour at width 3 when selected", () => {
    expect(fkStrokeStyle(true)).toMatchObject({
      stroke: "var(--vscode-charts-yellow, #e5c07b)",
      strokeWidth: 3,
    });
  });

  it("lets a caller's style override the defaults", () => {
    expect(fkStrokeStyle(false, { strokeWidth: 9, opacity: 0.5 })).toMatchObject({
      strokeWidth: 9,
      opacity: 0.5,
    });
  });
});
