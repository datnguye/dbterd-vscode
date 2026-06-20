// Pure path-building math for the composite FK edge. Kept separate from the
// React component so it can be unit-tested against fixed Point inputs without
// pulling xyflow into the test environment.

// Single canonical {x, y} type, shared with the layout primitives.
import type { Point } from "../../layout/overlap";

export type { Point };

export const BUNDLE_OFFSET = 40; // px the bundle point sits off the table edge
export const TAIL_CURVE_RATIO = 0.6; // fraction of tail length used for bezier control
export const BUNDLE_CURVE_RATIO = 0.7; // bundle midsection bezier control ratio

export function avgY(points: readonly Point[]): number {
  return points.reduce((sum, p) => sum + p.y, 0) / points.length;
}

export function bundlePoint(
  base: Point,
  width: number,
  sourceIsLeft: boolean,
  yCoord: number,
): Point {
  // Anchored to the *outer edge* of each table rather than to the first
  // column's x coordinate. Correct regardless of table width, and prevents
  // the bundle from landing inside the card for wide tables.
  const edgeX = sourceIsLeft ? base.x + width : base.x;
  const offset = sourceIsLeft ? BUNDLE_OFFSET : -BUNDLE_OFFSET;
  return { x: edgeX + offset, y: yCoord };
}

function horizontalCubic(from: Point, to: Point, ratio: number, leftward: boolean): string {
  const control = Math.abs(to.x - from.x) * ratio;
  const c1x = from.x + (leftward ? control : -control);
  const c2x = to.x - (leftward ? control : -control);
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
}

export function bundlePath(from: Point, to: Point, sourceIsLeft: boolean): string {
  return horizontalCubic(from, to, BUNDLE_CURVE_RATIO, sourceIsLeft);
}

export function tailPath(from: Point, to: Point): string {
  return horizontalCubic(from, to, TAIL_CURVE_RATIO, to.x - from.x >= 0);
}
