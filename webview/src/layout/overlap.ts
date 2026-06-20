// Shared overlap-resolution sweep used by the radial and force layouts. Nudges
// overlapping cards apart in-place along the axis of least penetration until
// their padded bounding boxes no longer intersect. Bounded iterations keep it
// cheap; both callers feed it a near-resolved layout so it converges fast.

import type { TableDimensions } from "./dimensions";

// Canonical 2-D point, shared across the layout engines and the FK-edge
// geometry (re-exported from composite-edge/geometry).
export interface Point {
  x: number;
  y: number;
}

export function relaxOverlaps(
  ids: readonly string[],
  centres: Map<string, Point>,
  dims: Map<string, TableDimensions>,
  pad: number,
  sweeps = 40,
): void {
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = centres.get(ids[i])!;
        const b = centres.get(ids[j])!;
        const da = dims.get(ids[i])!;
        const db = dims.get(ids[j])!;
        const minDx = da.width / 2 + db.width / 2 + pad;
        const minDy = da.height / 2 + db.height / 2 + pad;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = minDx - Math.abs(dx);
        const overlapY = minDy - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        // Resolve along the axis of least penetration — the smaller shove.
        if (overlapX < overlapY) {
          const shove = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= shove;
          b.x += shove;
        } else {
          const shove = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= shove;
          b.y += shove;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}
