// Shared between ErdTableNode (rendering) and layout.ts (dagre pre-sizing).
// Keep the two in lockstep — if this changes, both must honor it or dagre
// reserves the wrong amount of height and nodes overlap.

export const COLLAPSE_THRESHOLD = 5;
export const COLLAPSED_VISIBLE = 5;
export const COLLAPSE_TOGGLE_HEIGHT = 24;
