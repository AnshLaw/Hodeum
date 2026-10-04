import { describe, expect, it } from "vitest";
import type { LearnerAnnotation } from "../../lib/types";
import { placeOnPhone } from "./phone-annotation";

/** The mirror drawn at (100, 50) on screen, 400×800 physical px, showing a 1200×2400 frame. */
const CANVAS = { x: 100, y: 50, width: 400, height: 800 };
const FRAME = { width: 1200, height: 2400 };
const mark = (shape: LearnerAnnotation["shape"]): LearnerAnnotation => ({ id: "a", shape, intent: "ask", question: "what is this?", createdAt: 0 });

describe("placeOnPhone", () => {
  it("turns a box marked on the mirror into frame pixels on the phone", () => {
    const placed = placeOnPhone(mark({ kind: "rect", bounds: { x: 200, y: 150, width: 40, height: 20 } }), CANVAS, FRAME);
    expect(placed.surface).toBe("phone");
    expect(placed.shape.bounds).toEqual({ x: 300, y: 300, width: 120, height: 60 });
    expect(placed.question).toBe("what is this?");
  });

  it("moves a point and a freehand stroke along with their bounds", () => {
    const point = placeOnPhone(mark({ kind: "point", at: { x: 110, y: 60 }, bounds: { x: 100, y: 50, width: 20, height: 20 } }), CANVAS, FRAME);
    expect(point.shape).toEqual({ kind: "point", at: { x: 30, y: 30 }, bounds: { x: 0, y: 0, width: 60, height: 60 } });
    const stroke = placeOnPhone(mark({ kind: "stroke", points: [{ x: 100, y: 50 }, { x: 500, y: 850 }], bounds: CANVAS }), CANVAS, FRAME);
    expect(stroke.shape).toEqual({ kind: "stroke", points: [{ x: 0, y: 0 }, { x: 1200, y: 2400 }], bounds: { x: 0, y: 0, width: 1200, height: 2400 } });
  });

  it("leaves a mark elsewhere on the desktop alone", () => {
    const desktop = mark({ kind: "rect", bounds: { x: 700, y: 150, width: 40, height: 20 } });
    expect(placeOnPhone(desktop, CANVAS, FRAME)).toBe(desktop);
  });

  it("leaves the mark alone while nothing is drawn", () => {
    const any = mark({ kind: "rect", bounds: { x: 200, y: 150, width: 40, height: 20 } });
    expect(placeOnPhone(any, { ...CANVAS, width: 0 }, FRAME)).toBe(any);
    expect(placeOnPhone(any, CANVAS, { width: 0, height: 0 })).toBe(any);
  });
});
