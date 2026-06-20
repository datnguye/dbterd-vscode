import { memo, type ReactElement } from "react";
import { useInternalNode, type EdgeProps } from "@xyflow/react";

import {
  anchorNodeOf,
  endpointSides,
  fkStrokeStyle,
  resolveAnchor,
  type AnchorNode,
} from "../edge-anchor";
import { avgY, bundlePath, bundlePoint, tailPath, type Point } from "./geometry";

// Composite FK edge: renders one logical relationship that touches N columns
// on each side. Visually it's a single bundle in the middle, forking out to
// per-column tails at each endpoint — the way dbdiagram.io / Lucidchart draw
// multi-column FKs. Tails anchor on each column's row (index-based, so hidden
// columns land on the collapse boundary rather than piling on one handle).

interface CompositeEdgeData {
  from_columns: string[];
  to_columns: string[];
  [k: string]: unknown;
}

function columnPoints(node: AnchorNode, columns: readonly string[], sideIsLeft: boolean): Point[] {
  const points = columns.map((c) => resolveAnchor(node, c, sideIsLeft));
  // No columns at all → one anchor at the card edge mid-card keeps it visible.
  return points.length > 0 ? points : [resolveAnchor(node, null, sideIsLeft)];
}

export const CompositeEdge = memo(function CompositeEdge({
  source,
  target,
  data,
  style,
  markerEnd,
  selected,
}: EdgeProps): ReactElement | null {
  const fromNode = useInternalNode(source);
  const toNode = useInternalNode(target);
  const edgeData = data as CompositeEdgeData | undefined;

  const from = anchorNodeOf(fromNode);
  const to = anchorNodeOf(toNode);
  if (!from || !to || !edgeData) return null;

  const { fromIsLeft, toIsLeft } = endpointSides(from, to);
  const fromPoints = columnPoints(from, edgeData.from_columns, fromIsLeft);
  const toPoints = columnPoints(to, edgeData.to_columns, toIsLeft);

  const fromBundle = bundlePoint(from.base, from.width, !fromIsLeft, avgY(fromPoints));
  const toBundle = bundlePoint(to.base, to.width, !toIsLeft, avgY(toPoints));

  const strokeStyle = fkStrokeStyle(selected ?? false, style);
  const animated = selected ? "" : " animated";

  return (
    <g className="react-flow__edge-path erd-composite-edge">
      {/* Wide invisible hit-area over the bundle so clicks select the edge. */}
      <path
        d={bundlePath(fromBundle, toBundle, !fromIsLeft)}
        className="react-flow__edge-interaction"
        fill="none"
        stroke="transparent"
        strokeWidth={20}
      />
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
        d={bundlePath(fromBundle, toBundle, !fromIsLeft)}
        className={`erd-composite-bundle${animated}`}
        style={strokeStyle}
        markerEnd={markerEnd}
      />
      {/* Per-column tails, target side */}
      {toPoints.map((p, i) => (
        <path
          key={`to-${i}`}
          d={tailPath(toBundle, p)}
          className={`erd-composite-tail${animated}`}
          style={strokeStyle}
        />
      ))}
    </g>
  );
});
