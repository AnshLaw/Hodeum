import { describe, expect, it } from "vitest";
import { fitWithin, grayscale, meanLuma, phoneCrop, toneOf } from "./frame-math";

describe("phoneCrop", () => {
  it("keeps a portrait frame whole", () => {
    expect(phoneCrop(1170, 2532)).toEqual({ x: 0, y: 0, width: 1170, height: 2532 });
  });

  it("cuts the centred phone out of a pillarboxed 16:9 capture", () => {
    const crop = phoneCrop(1920, 1080);
    expect(crop.height).toBe(1080);
    expect(crop.width).toBe(498);
    expect(crop.x).toBe(711);
  });
});

describe("fitWithin", () => {
  it("shrinks the longest side to the limit, keeping the aspect", () => {
    expect(fitWithin(1170, 2532, 1280)).toEqual({ width: 591, height: 1280 });
    expect(fitWithin(400, 800, 1280)).toEqual({ width: 400, height: 800 });
  });
});

describe("tone", () => {
  it("averages luma from RGBA and calls black screens dark", () => {
    const black = grayscale(new Uint8ClampedArray([0, 0, 0, 255, 10, 10, 10, 255]));
    const white = grayscale(new Uint8ClampedArray([255, 255, 255, 255, 240, 240, 240, 255]));
    expect(meanLuma(black)).toBeLessThan(10);
    expect(toneOf(black)).toBe("dark");
    expect(toneOf(white)).toBe("light");
  });
});
