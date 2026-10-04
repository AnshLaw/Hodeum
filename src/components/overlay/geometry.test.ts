import { describe, expect, it } from "vitest";
import type { MonitorInfo } from "../../lib/types";
import { POINT_BOX_PX, composerPosition, primitiveToOverlay, shapeFromGesture, shapeToScreen } from "./geometry";

const viewport = { width: 1000, height: 800 };
const composer = { width: 300, height: 130 };
const monitor: MonitorInfo = { x: 1920, y: 0, width: 2560, height: 1440, scale: 1.25 };

describe("shapeFromGesture", () => {
  it("treats a tiny gesture as a point", () => {
    const shape = shapeFromGesture([{ x: 100, y: 100 }, { x: 103, y: 102 }], false);
    expect(shape).toEqual({ kind: "point", at: { x: 100, y: 100 }, bounds: { x: 76, y: 76, width: POINT_BOX_PX, height: POINT_BOX_PX } });
  });

  it("normalizes a rectangle dragged up and to the left", () => {
    expect(shapeFromGesture([{ x: 200, y: 150 }, { x: 120, y: 90 }], false)).toEqual({ kind: "rect", bounds: { x: 120, y: 90, width: 80, height: 60 } });
  });

  it("keeps a freehand stroke and its bounds", () => {
    const points = [{ x: 10, y: 10 }, { x: 60, y: 20 }, { x: 30, y: 70 }];
    expect(shapeFromGesture(points, true)).toEqual({ kind: "stroke", points, bounds: { x: 10, y: 10, width: 50, height: 60 } });
  });
});

describe("coordinate conversion", () => {
  it("converts an annotation to physical screen pixels", () => {
    const shape = shapeToScreen({ kind: "point", at: { x: 80, y: 80 }, bounds: { x: 80, y: 80, width: 40, height: 40 } }, monitor);
    expect(shape).toEqual({ kind: "point", at: { x: 2020, y: 100 }, bounds: { x: 2020, y: 100, width: 50, height: 50 } });
  });

  it("converts overlay primitives into overlay CSS pixels", () => {
    expect(primitiveToOverlay({ kind: "arrow", to: { x: 2020, y: 100, width: 50, height: 50 } }, monitor)).toEqual({ kind: "arrow", to: { x: 80, y: 80, width: 40, height: 40 } });
  });

  it("maps a highlight's nearby text with it, so the label avoids it at any DPI", () => {
    const highlight = { kind: "highlight" as const, bounds: { x: 2020, y: 100, width: 50, height: 50 }, emphasis: "precise" as const, keepClear: [{ x: 2020, y: 50, width: 100, height: 25 }] };
    expect(primitiveToOverlay(highlight, monitor)).toMatchObject({ bounds: { x: 80, y: 80 }, keepClear: [{ x: 80, y: 40, width: 80, height: 20 }] });
  });
});

describe("composerPosition", () => {
  it("sits to the right of the mark when there is room", () => {
    expect(composerPosition({ x: 100, y: 200, width: 50, height: 30 }, viewport, composer)).toEqual({ x: 162, y: 200 });
  });

  it("flips left near the right edge", () => {
    expect(composerPosition({ x: 800, y: 200, width: 100, height: 30 }, viewport, composer)).toEqual({ x: 488, y: 200 });
  });

  it("drops below a full-width mark and stays on-screen", () => {
    expect(composerPosition({ x: 20, y: 750, width: 960, height: 40 }, viewport, composer)).toEqual({ x: 20, y: 658 });
  });
});
