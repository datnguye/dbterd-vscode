import { describe, expect, it } from "vitest";

import {
  avgY,
  bundlePath,
  bundlePoint,
  BUNDLE_OFFSET,
  tailPath,
  type Point,
} from "@/components/composite-edge/geometry";

describe("avgY", () => {
  it("returns the y mean of a single point", () => {
    expect(avgY([{ x: 0, y: 100 }])).toBe(100);
  });

  it("averages multiple ys", () => {
    const points: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 200 },
    ];
    expect(avgY(points)).toBe(100);
  });
});

describe("bundlePoint", () => {
  it("anchors to the right edge when source is on the left", () => {
    const point = bundlePoint({ x: 100, y: 50 }, 200, true, 75);
    // base.x + width = 300, then + BUNDLE_OFFSET further toward target.
    expect(point.x).toBe(300 + BUNDLE_OFFSET);
    expect(point.y).toBe(75);
  });

  it("anchors to the left edge when source is on the right", () => {
    const point = bundlePoint({ x: 100, y: 50 }, 200, false, 75);
    // base.x = 100, then - BUNDLE_OFFSET further toward target.
    expect(point.x).toBe(100 - BUNDLE_OFFSET);
    expect(point.y).toBe(75);
  });
});

describe("bundlePath", () => {
  it("emits a cubic bezier between the two bundle points", () => {
    const path = bundlePath({ x: 0, y: 0 }, { x: 100, y: 0 }, true);
    expect(path).toMatch(/^M 0 0 C \d/);
    expect(path).toContain("100 0");
  });

  it("flips the bezier control direction when source is on the right", () => {
    const left = bundlePath({ x: 100, y: 0 }, { x: 0, y: 0 }, false);
    const right = bundlePath({ x: 0, y: 0 }, { x: 100, y: 0 }, true);
    expect(left).not.toEqual(right);
  });
});

describe("tailPath", () => {
  it("draws a smooth horizontal-tangent bezier", () => {
    const path = tailPath({ x: 0, y: 0 }, { x: 100, y: 50 });
    // First control point must share the source's y to keep the tail horizontal
    // at the table edge.
    expect(path).toMatch(/^M 0 0 C 60 0,/);
  });

  it("handles right-to-left tails (negative dx)", () => {
    const path = tailPath({ x: 100, y: 0 }, { x: 0, y: 50 });
    // dx=-100, control = 60. c1x = from.x - 60 = 40; c2x = to.x + 60 = 60.
    expect(path).toMatch(/^M 100 0 C 40 0, 60 50/);
  });
});
