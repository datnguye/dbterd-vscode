import { memo, type ReactElement } from "react";
import { BaseEdge, useInternalNode, type EdgeProps } from "@xyflow/react";

import { anchorNodeOf, endpointSides, fkStrokeStyle, resolveAnchor } from "../edge-anchor";
import { tailPath } from "../composite-edge/geometry";

// Single-column FK edge. It anchors on the FK column's row — computed from the
// column's index in the rendered list (not handle bounds, which only exist for
// visible rows) — and picks the card side each endpoint faces from node
// positions. A hidden column anchors at the collapse boundary. Rendered via
// BaseEdge so it keeps React Flow's interaction hit-area and click highlight.

interface SingleEdgeData {
  from_column: string | null;
  to_column: string | null;
  relationship_type?: string | null;
  [k: string]: unknown;
}

export const SingleEdge = memo(function SingleEdge({
  source,
  target,
  data,
  style,
  markerEnd,
  selected,
}: EdgeProps): ReactElement | null {
  const fromNode = useInternalNode(source);
  const toNode = useInternalNode(target);

  const from = anchorNodeOf(fromNode);
  const to = anchorNodeOf(toNode);
  if (!from || !to) return null;

  const edgeData = data as SingleEdgeData | undefined;
  const fromCol = edgeData?.from_column ?? null;
  const toCol = edgeData?.to_column ?? null;
  const isFk = edgeData?.relationship_type === "fk";

  const { fromIsLeft, toIsLeft } = endpointSides(from, to);
  const fromPoint = resolveAnchor(from, fromCol, fromIsLeft);
  const toPoint = resolveAnchor(to, toCol, toIsLeft);

  return (
    <BaseEdge
      path={tailPath(fromPoint, toPoint)}
      markerEnd={markerEnd}
      className={`erd-single-edge${isFk && !selected ? " animated" : ""}`}
      style={fkStrokeStyle(selected ?? false, style)}
    />
  );
});
