// Force-directed ("organic") layout — a compact spring simulation tuned for
// star/snowflake schemas where a dimension is shared by many fact tables.
// Edges act as springs and nodes repel, so a shared dimension settles in the
// middle of its facts and *every* edge stays short (a tree layout can only
// shorten the one spanning-tree edge per node; this shortens them all).
//
// Deterministic: the initial placement is a seeded circle (index-based, no RNG —
// scripts can't use Math.random anyway) and the integration is fixed-iteration,
// so the same payload always lays out identically.

import type { ErdEdge, ErdNode } from "../types/erd";
import type { TableDimensions } from "./dimensions";
import type { LaidOutNode } from "./dagre";
import {
  buildAdjacency,
  buildDimensions,
  clamp,
  ISLAND_GAP,
  layoutIslandGrid,
  normalizeToOrigin,
  projectLaidOut,
  splitConnected,
} from "./graph";
import { relaxOverlaps, type Point } from "./overlap";

// Simulation tuning. ITERATIONS trades quality for cost; 300 is ample for a few
// hundred nodes and runs in a few ms.
const ITERATIONS = 300;
const REPULSION = 320_000; // node-node anti-overlap strength (Coulomb-like)
const SPRING = 0.02; // edge spring stiffness
const SPRING_LENGTH = 80; // desired gap between connected card edges
const CENTER_PULL = 0.012; // gentle pull to the origin so the graph stays compact
const DAMPING = 0.85; // velocity decay per step (settles the system)
const MAX_STEP = 60; // clamp per-iteration movement so nothing flies off
// Floor on the centre-to-centre distance used in the repulsion divisor. Two
// bodies can drift arbitrarily close mid-simulation; without a floor,
// REPULSION/distSq blows up to Infinity and NaN-poisons every position.
const MIN_DIST = 1;

interface Body {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Collision radius from the card's half-diagonal — keeps wide cards apart.
  radius: number;
  dim: TableDimensions;
}

function simulate(bodies: Body[], edges: readonly ErdEdge[]): void {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  // Pre-resolve edge endpoints to bodies once; skip self-loops and danglers.
  const springs = edges
    .map((e) => ({ a: byId.get(e.from_id), b: byId.get(e.to_id) }))
    .filter((s): s is { a: Body; b: Body } => !!s.a && !!s.b && s.a !== s.b);

  for (let step = 0; step < ITERATIONS; step++) {
    // Repulsion — every pair pushes apart (O(n²); fine for a few hundred nodes).
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy;
        if (distSq === 0) {
          // Coincident bodies: nudge deterministically by index so they split.
          dx = (i - j) || 1;
          dy = 1;
          distSq = dx * dx + dy * dy;
        }
        // Floor the distance so a near-coincident pair can't drive the
        // repulsion divisor to ~0 and overflow to Infinity/NaN.
        distSq = Math.max(distSq, MIN_DIST * MIN_DIST);
        const dist = Math.sqrt(distSq);
        // Stronger push when cards would overlap (within combined radii).
        const minDist = a.radius + b.radius;
        const force = REPULSION / distSq + (dist < minDist ? (minDist - dist) * 4 : 0);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Springs — connected nodes pull toward the desired separation.
    for (const { a, b } of springs) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = a.radius + b.radius + SPRING_LENGTH;
      const force = SPRING * (dist - target);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Centering + integrate.
    for (const body of bodies) {
      body.vx -= body.x * CENTER_PULL;
      body.vy -= body.y * CENTER_PULL;
      body.vx *= DAMPING;
      body.vy *= DAMPING;
      body.x += clamp(body.vx, -MAX_STEP, MAX_STEP);
      body.y += clamp(body.vy, -MAX_STEP, MAX_STEP);
    }
  }
}

export function runForceLayout(
  nodes: readonly ErdNode[],
  edges: readonly ErdEdge[],
): LaidOutNode[] {
  const dims = buildDimensions(nodes);

  const adj = buildAdjacency(edges);
  const { connected, islands: islandIds } = splitConnected(
    nodes.map((n) => n.id),
    adj,
  );
  const connectedSet = new Set(connected);
  const connectedNodes = nodes.filter((n) => connectedSet.has(n.id));

  // Seed connected nodes on a circle sized to the node count so the simulation
  // starts spread out (faster, more stable convergence than a tight cluster).
  const seedRadius = Math.max(200, connectedNodes.length * 24);
  const bodies: Body[] = connectedNodes.map((node, i) => {
    const angle = (i / Math.max(connectedNodes.length, 1)) * 2 * Math.PI;
    const dim = dims.get(node.id)!;
    return {
      id: node.id,
      x: Math.cos(angle) * seedRadius,
      y: Math.sin(angle) * seedRadius,
      vx: 0,
      vy: 0,
      radius: Math.hypot(dim.width, dim.height) / 2,
      dim,
    };
  });

  simulate(bodies, edges);

  // The simulation's repulsion keeps cards mostly apart, but dense clusters can
  // leave a few residual overlaps — a relaxation sweep guarantees none remain.
  const centres = new Map<string, Point>(bodies.map((b) => [b.id, { x: b.x, y: b.y }]));
  relaxOverlaps(connected, centres, dims, SPRING_LENGTH / 2);

  // Convert the relaxed centres to top-left, normalising the connected graph to
  // a (0,0)-anchored bounding box.
  const { positions, box } = normalizeToOrigin(connected, centres, dims);
  const connectedHeight = box.maxY - box.minY;

  // Pack islands in a grid below the connected graph.
  if (islandIds.length > 0) {
    const { positions: islandPositions } = layoutIslandGrid(
      islandIds,
      dims,
      0,
      connectedHeight + ISLAND_GAP,
    );
    for (const [id, pos] of islandPositions) positions.set(id, pos);
  }

  return projectLaidOut(nodes, positions, dims);
}
