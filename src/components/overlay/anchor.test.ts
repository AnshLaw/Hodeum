import { describe, expect, it } from "vitest";
import type { OverlayPrimitive, WindowRef } from "../../lib/types";
import { anchorPrimitives } from "./anchor";

const EXCEL: WindowRef = { id: 1, bounds: { x: 100, y: 50, width: 800, height: 600 } };
const CHROME: WindowRef = { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1040 } };
const HIGHLIGHT: OverlayPrimitive = { kind: "highlight", bounds: { x: 200, y: 100, width: 40, height: 20 }, emphasis: "precise" };

describe("anchorPrimitives", () => {
  it("draws unanchored guidance as it is (the browser stage has no windows)", () => {
    expect(anchorPrimitives([HIGHLIGHT], undefined, CHROME)).toEqual({ primitives: [HIGHLIGHT] });
  });

  it("draws guidance over its own window, clipped to it", () => {
    expect(anchorPrimitives([HIGHLIGHT], EXCEL, EXCEL)).toEqual({ primitives: [HIGHLIGHT], clip: EXCEL.bounds });
  });

  it("hides guidance while another window is in front", () => {
    expect(anchorPrimitives([HIGHLIGHT], EXCEL, CHROME)).toEqual({ primitives: [] });
  });

  it("hides guidance while no app window is in front (desktop, taskbar, minimized)", () => {
    expect(anchorPrimitives([HIGHLIGHT], EXCEL, null)).toEqual({ primitives: [] });
  });

  it("keeps guidance clipped to its window until the front window is known", () => {
    expect(anchorPrimitives([HIGHLIGHT], EXCEL, undefined)).toEqual({ primitives: [HIGHLIGHT], clip: EXCEL.bounds });
  });

  it("moves guidance with its window", () => {
    const moved: WindowRef = { id: 1, bounds: { ...EXCEL.bounds, x: 150, y: 70 } };
    const { primitives, clip } = anchorPrimitives([HIGHLIGHT], EXCEL, moved);
    expect(primitives).toEqual([{ ...HIGHLIGHT, bounds: { x: 250, y: 120, width: 40, height: 20 } }]);
    expect(clip).toEqual(moved.bounds);
  });

  it("hides guidance once its window is resized, since the controls under it moved", () => {
    const resized: WindowRef = { id: 1, bounds: { ...EXCEL.bounds, width: 1000 } };
    expect(anchorPrimitives([HIGHLIGHT], EXCEL, resized).primitives).toEqual([]);
  });

  it("draws a mark only over the window it was made on", () => {
    const pin: OverlayPrimitive = { kind: "pin", bounds: { x: 300, y: 300, width: 50, height: 50 }, window: CHROME };
    expect(anchorPrimitives([HIGHLIGHT, pin], EXCEL, EXCEL).primitives).toEqual([HIGHLIGHT]);
    expect(anchorPrimitives([HIGHLIGHT, pin], EXCEL, CHROME)).toEqual({ primitives: [pin], clip: CHROME.bounds });
  });

  it("moves an arrow's target and a label's keep-clear zones too", () => {
    const moved: WindowRef = { id: 1, bounds: { ...EXCEL.bounds, x: 110 } };
    const arrow: OverlayPrimitive = { kind: "arrow", to: HIGHLIGHT.bounds };
    const labelled: OverlayPrimitive = { ...HIGHLIGHT, keepClear: [{ x: 0, y: 0, width: 10, height: 10 }] };
    const { primitives } = anchorPrimitives([arrow, labelled], EXCEL, moved);
    expect(primitives[0]).toEqual({ kind: "arrow", to: { ...HIGHLIGHT.bounds, x: 210 } });
    expect(primitives[1]).toMatchObject({ bounds: { x: 210 }, keepClear: [{ x: 10, y: 0, width: 10, height: 10 }] });
  });
});
