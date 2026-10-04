import { describe, expect, it } from "vitest";
import { fitInside, insetsFor } from "./unfold";

const APP = { width: 1120, height: 740 };

describe("fitInside", () => {
  it("keeps a notch that already lies inside the app window", () => {
    expect(fitInside({ x: 460, y: 0, width: 200, height: 36 }, APP)).toEqual({ x: 460, y: 0, width: 200, height: 36 });
  });

  it("slides a notch above the window down onto its top edge", () => {
    expect(fitInside({ x: 460, y: -56, width: 200, height: 36 }, APP)).toEqual({ x: 460, y: 0, width: 200, height: 36 });
  });

  it("turns a full-height sidebar left of the window into a strip on its left edge", () => {
    expect(fitInside({ x: -400, y: -56, width: 360, height: 1040 }, APP)).toEqual({ x: 0, y: 0, width: 360, height: 740 });
  });

  it("slides a sidebar right of the window onto its right edge", () => {
    expect(fitInside({ x: 1300, y: 0, width: 360, height: 200 }, APP)).toEqual({ x: 760, y: 0, width: 360, height: 200 });
  });

  it("treats a negative size as empty", () => {
    expect(fitInside({ x: 10, y: 10, width: -5, height: -5 }, APP)).toEqual({ x: 10, y: 10, width: 0, height: 0 });
  });
});

describe("insetsFor", () => {
  it("crops the window to the notch's rect", () => {
    expect(insetsFor({ x: 460, y: 0, width: 200, height: 36 }, APP)).toBe("inset(0px 460px 704px 460px round 18px)");
  });

  it("never crops to nothing when the notch sat outside the window", () => {
    expect(insetsFor({ x: 460, y: -56, width: 200, height: 36 }, APP)).toBe("inset(0px 460px 704px 460px round 18px)");
  });
});
