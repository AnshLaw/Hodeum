import { describe, expect, it } from "vitest";
import { GUIDANCE_CARD_HEIGHT, coversTarget, guidanceFootprint } from "./footprint";
import { NOTCH_WIDTHS } from "./notch-view";

describe("guidanceFootprint", () => {
  it("is centred in the notch window and scaled to physical pixels", () => {
    const footprint = guidanceFootprint({ x: 1000, y: 0, scale: 1.25 }, 600);
    const left = (600 - NOTCH_WIDTHS.guidance) / 2;
    expect(footprint).toEqual({ x: 1000 + left * 1.25, y: 0, width: NOTCH_WIDTHS.guidance * 1.25, height: GUIDANCE_CARD_HEIGHT * 1.25 });
  });
});

describe("coversTarget", () => {
  const footprint = { x: 100, y: 0, width: 440, height: 160 };

  it("detects a highlight under the card", () => {
    expect(coversTarget(footprint, [{ kind: "highlight", bounds: { x: 300, y: 100, width: 60, height: 30 }, emphasis: "precise" }])).toBe(true);
  });

  it("ignores targets elsewhere and non-highlight primitives", () => {
    expect(coversTarget(footprint, [{ kind: "highlight", bounds: { x: 800, y: 100, width: 60, height: 30 }, emphasis: "precise" }])).toBe(false);
    expect(coversTarget(footprint, [{ kind: "pin", bounds: { x: 300, y: 100, width: 60, height: 30 } }])).toBe(false);
  });
});
