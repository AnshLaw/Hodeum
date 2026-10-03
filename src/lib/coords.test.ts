import { describe, expect, it } from "vitest";
import { boundsOf, intersects, padRect, toOverlay, toScreen } from "./coords";
import type { MonitorInfo } from "./types";

const primary: MonitorInfo = { x: 0, y: 0, width: 1920, height: 1080, scale: 1 };
const secondary125: MonitorInfo = { x: 1920, y: 0, width: 2560, height: 1440, scale: 1.25 };
const scaled150: MonitorInfo = { x: 0, y: 0, width: 2880, height: 1800, scale: 1.5 };

describe("toOverlay", () => {
  it("is the identity on an unscaled primary monitor", () => {
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(toOverlay(rect, primary)).toEqual(rect);
  });

  it("subtracts the monitor origin and divides by the scale", () => {
    expect(toOverlay({ x: 2020, y: 100, width: 125, height: 50 }, secondary125)).toEqual({ x: 80, y: 80, width: 100, height: 40 });
  });

  it("handles 150% scaling", () => {
    expect(toOverlay({ x: 300, y: 150, width: 90, height: 45 }, scaled150)).toEqual({ x: 200, y: 100, width: 60, height: 30 });
  });
});

describe("toScreen", () => {
  it("inverts toOverlay", () => {
    const rect = { x: 2020, y: 100, width: 125, height: 50 };
    expect(toScreen(toOverlay(rect, secondary125), secondary125)).toEqual(rect);
  });
});

describe("geometry helpers", () => {
  it("pads a rect on every side", () => {
    expect(padRect({ x: 10, y: 10, width: 20, height: 20 }, 5)).toEqual({ x: 5, y: 5, width: 30, height: 30 });
  });

  it("detects overlap but not touching edges", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(intersects(a, { x: 50, y: 50, width: 1, height: 1 })).toBe(false);
  });

  it("computes the bounds of points and rejects an empty list", () => {
    expect(boundsOf([{ x: 5, y: 9 }, { x: 1, y: 3 }])).toEqual({ x: 1, y: 3, width: 4, height: 6 });
    expect(() => boundsOf([])).toThrow();
  });
});
