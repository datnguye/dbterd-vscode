import { memo, type ReactElement } from "react";
import { useInternalNode, type EdgeProps } from "@xyflow/react";

import { inHandle, outHandle, TABLE_IN, TABLE_OUT } from "../../layout/handles";
import {
  avgY,
  bundlePath,
  bundlePoint,
  tailPath,
  type Point,
} from "./geometry";

// Composite FK edge: renders one logical relationship that touches N columns
// on each side. Visually it's a single bundle in the middle, forking out to
// per-column tails at each endpoint — the way dbdiagram.io / Lucidchart draw
// multi-column FKs.

interface CompositeEdgeData {
  from_columns: string[];
  to_columns: string[];
  [k: string]: unknown;
}

const MIN_NODE_WIDTH = 220; // fallback when xyflow hasn't measured yet

function findHandle(
  handles: readonly { id?: string | null; x: number; y: number }[] | null | undefined,
  handleId: string,
): { x: number; y: number } | undefined {
  if (!handles) return undefined;
  const match = handles.find((h) => h.id === handleId);
  return match ? { x: match.x, y: match.y } : undefined;
}

function collectPoints(
  base: Point,
  handles: readonly { id?: string | null; x: number; y: number }[] | null,
  columns: readonly string[],
  toHandleId: (col: string) => string,
  fallbackId: string,
): Point[] {
  const points: Point[] = [];
  for (const col of columns) {
    const h = findHandle(handles, toHandleId(col));
    if (h) points.push({ x: base.x + h.x, y: base.y + h.y });
  }
  if (points.length === 0) {
    // Fall back to the table-level handle if column handles didn't resolve.
    // Keeps the edge visible even when the catalog is missing columns we
    // expected.
    const h = findHandle(handles, fallbackId);
    if (h) points.push({ x: base.x + h.x, y: base.y + h.y });
  }
  return points;
}

export const CompositeEdge = memo(function CompositeEdge({
  source,
  target,
  data,
  style,
  markerEnd,
}: EdgeProps): ReactElement | null {
  const fromNode = useInternalNode(source);
  const toNode = useInternalNode(target);
  const edgeData = data as CompositeEdgeData | undefined;

  if (!fromNode || !toNode || !edgeData) return null;

  const fromBase = fromNode.internals.positionAbsolute;
  const toBase = toNode.internals.positionAbsolute;
  const fromHandles = fromNode.internals.handleBounds?.source ?? null;
  const toHandles = toNode.internals.handleBounds?.target ?? null;
  // `measured` is populated by xyflow once the node renders; it's the source
  // of truth for actual card width, which varies with column-name length.
  // Fall back to `width` (React Flow node type) when measurement hasn't
  // landed yet — first paint still draws a reasonable bundle.
  const fromWidth = fromNode.measured?.width ?? fromNode.width ?? MIN_NODE_WIDTH;
  const toWidth = toNode.measured?.width ?? toNode.width ?? MIN_NODE_WIDTH;

  const sourceIsLeft = fromBase.x < toBase.x;

  const fromPoints = collectPoints(
    fromBase,
    fromHandles,
    edgeData.from_columns,
    outHandle,
    TABLE_OUT,
  );
  const toPoints = collectPoints(
    toBase,
    toHandles,
    edgeData.to_columns,
    inHandle,
    TABLE_IN,
  );
  if (fromPoints.length === 0 || toPoints.length === 0) return null;

  const fromBundle = bundlePoint(fromBase, fromWidth, sourceIsLeft, avgY(fromPoints));
  const toBundle = bundlePoint(toBase, toWidth, !sourceIsLeft, avgY(toPoints));

  const strokeStyle = {
    stroke: "var(--vscode-focusBorder, #007acc)",
    strokeWidth: 2,
    fill: "none",
    ...style,
  };

  return (
    <g className="react-flow__edge-path erd-composite-edge">
      {/* Per-column tails, source side */}
      {fromPoints.map((p, i) => (
        <path
          key={`from-${i}`}
          d={tailPath(p, fromBundle)}
          className="erd-composite-tail"
          style={strokeStyle}
        />
      ))}
      {/* Bundled middle — animated dashed stroke to match single-column FKs. */}
      <path
        d={bundlePath(fromBundle, toBundle, sourceIsLeft)}
        className="erd-composite-bundle animated"
        style={strokeStyle}
        markerEnd={markerEnd}
      />
      {/* Per-column tails, target side */}
      {toPoints.map((p, i) => (
        <path
          key={`to-${i}`}
          d={tailPath(toBundle, p)}
          className="erd-composite-tail animated"
          style={strokeStyle}
        />
      ))}
    </g>
  );
});
