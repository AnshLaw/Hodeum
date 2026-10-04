import { describe, expect, it } from "vitest";
import { GUIDANCE_CARD_HEIGHT, TARGET_RING_REACH_PX, coversTarget, guidanceFootprint, notchScreenRect, withinWindow } from "./footprint";
import { NOTCH_WIDTHS } from "./notch-view";

describe("withinWindow", () => {
  it("keeps only the part of the tucked orb that shows, where it sinks into the top edge", () => {
    expect(withinWindow({ x: 280, y: -4, width: 40, height: 40 }, { width: 600, height: 620 })).toEqual({ x: 280, y: 0, width: 40, height: 36 });
  });

  it("does the same at a side dock's screen edge, left or right", () => {
    const strip = { width: 360, height: 1032 };
    expect(withinWindow({ x: -4, y: 496, width: 40, height: 40 }, strip)).toEqual({ x: 0, y: 496, width: 36, height: 40 });
    expect(withinWindow({ x: 324, y: 496, width: 40, height: 40 }, strip)).toEqual({ x: 324, y: 496, width: 36, height: 40 });
  });

  it("leaves a surface inside the window as it is, and gives nothing for one outside it", () => {
    expect(withinWindow({ x: 52, y: 0, width: 496, height: 120 }, { width: 600, height: 620 })).toEqual({ x: 52, y: 0, width: 496, height: 120 });
    expect(withinWindow({ x: 0, y: -200, width: 100, height: 50 }, { width: 600, height: 620 })).toEqual({ x: 0, y: 0, width: 100, height: 0 });
  });
});

describe("guidanceFootprint", () => {
  const origin = { x: 1000, y: 0, scale: 1.25 };
  const left = (600 - NOTCH_WIDTHS.guidance) / 2;

  it("is centred in the notch window and scaled to physical pixels, reaching as far as the target's ring", () => {
    const footprint = guidanceFootprint(origin, 600);
    expect(footprint).toEqual({ x: 1000 + left * 1.25, y: 0, width: NOTCH_WIDTHS.guidance * 1.25, height: (GUIDANCE_CARD_HEIGHT + TARGET_RING_REACH_PX) * 1.25 });
  });

  it("uses the card's measured height when it's known, so a taller card (two-line text, Hindi) still steps aside", () => {
    const measured = GUIDANCE_CARD_HEIGHT + 40;
    expect(guidanceFootprint(origin, 600, measured).height).toBe((measured + TARGET_RING_REACH_PX) * 1.25);
  });
});

describe("notchScreenRect", () => {
  it("maps the surface's box in the notch window to physical screen pixels", () => {
    const rect = notchScreenRect({ x: 52, y: 0, width: 496, height: 120 }, { x: 1920, y: 0, scale: 1.5 });
    expect(rect).toEqual({ x: 1920 + 52 * 1.5, y: 0, width: 496 * 1.5, height: 180 });
  });
});

describe("coversTarget", () => {
  const footprint = { x: 100, y: 0, width: 440, height: 160 };

  it("detects a highlight under the card", () => {
    expect(coversTarget(footprint, [{ kind: "highlight", bounds: { x: 300, y: 100, width: 60, height: 30 }, emphasis: "precise" }])).toBe(true);
  });

  it("detects a huge highlight whose top edge alone runs under the card", () => {
    expect(coversTarget(footprint, [{ kind: "highlight", bounds: { x: 0, y: 150, width: 1200, height: 500 }, emphasis: "precise" }])).toBe(true);
  });

  it("ignores targets elsewhere and non-highlight primitives", () => {
    expect(coversTarget(footprint, [{ kind: "highlight", bounds: { x: 800, y: 100, width: 60, height: 30 }, emphasis: "precise" }])).toBe(false);
    expect(coversTarget(footprint, [{ kind: "pin", bounds: { x: 300, y: 100, width: 60, height: 30 } }])).toBe(false);
  });
});
