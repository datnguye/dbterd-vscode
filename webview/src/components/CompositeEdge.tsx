import { memo, type ReactElement } from "react";
import { useInternalNode, type EdgeProps } from "@xyflow/react";

// Composite FK edge: renders one logical relationship that touches N columns
// on each side. Visually it's a single bundle in the middle, forking out to
// per-column tails at each endpoint — the way dbdiagram.io / Lucidchart draw
// multi-column FKs.
//
// Algorithm:
//   1. Look up each endpoint's absolute handle position by column name.
//   2. Compute a "bundle point" per side, sitting a few pixels outside the
//      table toward the other node. All tails on that side converge there.
//   3. Draw one straight tail per column + one bezier between the two bundle
//      points.

interface CompositeEdgeData {
  from_columns: string[];
  to_columns: string[];
  [k: string]: unknown;
}

const BUNDLE_OFFSET = 40; // px the bundle point sits off the table edge
const TAIL_CURVE_RATIO = 0.6; // fraction of tail length used for bezier control
const BUNDLE_CURVE_RATIO = 0.7; // bundle midsection bezier control ratio
const MIN_NODE_WIDTH = 220; // fallback when xyflow hasn't measured yet

function findHandle(
  handles: readonly { id?: string | null; x: number; y: number }[] | null | undefined,
  handleId: string,
): { x: number; y: number } | undefined {
  if (!handles) return undefined;
  const match = handles.find((h) => h.id === handleId);
  return match ? { x: match.x, y: match.y } : undefined;
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
  const fromWidth =
    fromNode.measured?.width ?? fromNode.width ?? MIN_NODE_WIDTH;
  const toWidth = toNode.measured?.width ?? toNode.width ?? MIN_NODE_WIDTH;

  // Determine layout direction: is the source to the left or right of target?
  // We use this to offset bundle points and pick which side's handle to hit.
  const sourceIsLeft = fromBase.x < toBase.x;

  const fromPoints: Array<{ x: number; y: number }> = [];
  for (const col of edgeData.from_columns) {
    const handle = findHandle(fromHandles, `${col}__out`);
    if (handle) {
      fromPoints.push({ x: fromBase.x + handle.x, y: fromBase.y + handle.y });
    }
  }
  const toPoints: Array<{ x: number; y: number }> = [];
  for (const col of edgeData.to_columns) {
    const handle = findHandle(toHandles, `${col}__in`);
    if (handle) {
      toPoints.push({ x: toBase.x + handle.x, y: toBase.y + handle.y });
    }
  }

  // Fall back to the table-level handles if columns didn't resolve. Keeps the
  // edge visible even when the catalog is missing columns we expected.
  if (fromPoints.length === 0) {
    const handle = findHandle(fromHandles, "__table_out");
    if (handle) fromPoints.push({ x: fromBase.x + handle.x, y: fromBase.y + handle.y });
  }
  if (toPoints.length === 0) {
    const handle = findHandle(toHandles, "__table_in");
    if (handle) toPoints.push({ x: toBase.x + handle.x, y: toBase.y + handle.y });
  }
  if (fromPoints.length === 0 || toPoints.length === 0) return null;

  // Bundle points: anchored to the *outer edge* of each table (source-right
  // for a left-to-right flow, source-left otherwise) rather than to the first
  // column's x coordinate. This is correct regardless of table width, and
  // prevents the bundle from landing inside the card for wide tables.
  const avgY = (points: Array<{ x: number; y: number }>): number =>
    points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const fromEdgeX = sourceIsLeft ? fromBase.x + fromWidth : fromBase.x;
  const toEdgeX = sourceIsLeft ? toBase.x : toBase.x + toWidth;
  const fromBundle = {
    x: fromEdgeX + (sourceIsLeft ? BUNDLE_OFFSET : -BUNDLE_OFFSET),
    y: avgY(fromPoints),
  };
  const toBundle = {
    x: toEdgeX + (sourceIsLeft ? -BUNDLE_OFFSET : BUNDLE_OFFSET),
    y: avgY(toPoints),
  };

  const strokeStyle = {
    stroke: "var(--vscode-focusBorder, #007acc)",
    strokeWidth: 2,
    fill: "none",
    ...style,
  };

  // Curved bundled middle: cubic bezier with strong horizontal tangents on
  // both sides so the midsection reads as a smooth "cable" rather than an
  // angled line.
  const dx = toBundle.x - fromBundle.x;
  const bundleControl = Math.abs(dx) * BUNDLE_CURVE_RATIO;
  const bundlePath = `M ${fromBundle.x} ${fromBundle.y} C ${fromBundle.x + (sourceIsLeft ? bundleControl : -bundleControl)} ${fromBundle.y}, ${toBundle.x - (sourceIsLeft ? bundleControl : -bundleControl)} ${toBundle.y}, ${toBundle.x} ${toBundle.y}`;

  // Rounded tails: each column handle is pulled horizontally out of the table
  // edge, then curves smoothly into the shared bundle point. Horizontal-first
  // tangents prevent the tails from clipping back into the node card.
  const tailPath = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): string => {
    const tdx = to.x - from.x;
    const control = Math.abs(tdx) * TAIL_CURVE_RATIO;
    const c1x = from.x + (tdx >= 0 ? control : -control);
    const c2x = to.x - (tdx >= 0 ? control : -control);
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
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
        d={bundlePath}
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
