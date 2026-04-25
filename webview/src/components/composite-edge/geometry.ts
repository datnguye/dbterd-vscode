// Pure path-building math for the composite FK edge. Kept separate from the
// React component so it can be unit-tested against fixed Point inputs without
// pulling xyflow into the test environment.

export interface Point {
  x: number;
  y: number;
}

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

export function bundlePath(from: Point, to: Point, sourceIsLeft: boolean): string {
  // Curved bundled middle: cubic bezier with strong horizontal tangents on
  // both sides so the midsection reads as a smooth "cable" rather than an
  // angled line.
  const dx = to.x - from.x;
  const control = Math.abs(dx) * BUNDLE_CURVE_RATIO;
  const c1x = from.x + (sourceIsLeft ? control : -control);
  const c2x = to.x - (sourceIsLeft ? control : -control);
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
}

export function tailPath(from: Point, to: Point): string {
  // Rounded tails: each column handle is pulled horizontally out of the table
  // edge, then curves smoothly into the shared bundle point. Horizontal-first
  // tangents prevent the tails from clipping back into the node card.
  const dx = to.x - from.x;
  const control = Math.abs(dx) * TAIL_CURVE_RATIO;
  const c1x = from.x + (dx >= 0 ? control : -control);
  const c2x = to.x - (dx >= 0 ? control : -control);
  return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
}
