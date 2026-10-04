import { describe, expect, it } from "vitest";
import { IPHONE_ASPECT } from "../../features/phone/frame-math";
import { PHONE_LAYOUT, frameAspect, markRect, phoneNotchHeight, phoneNotchWidth, phoneScreenSize, visibleRoom } from "./phone-layout";

/** 1080p work area (taskbar at the bottom) inside the tall notch window. */
const ROOM_1080 = { width: 840, height: 1040 };
/** 1366×768 laptop at 100%. */
const ROOM_768 = { width: 840, height: 728 };
const IPHONE_15 = { width: 1179, height: 2556 };

describe("frameAspect", () => {
  it("uses the incoming frame's real shape", () => {
    expect(frameAspect(IPHONE_15)).toBeCloseTo(1179 / 2556);
    expect(frameAspect({ width: 280, height: 600 })).toBeCloseTo(280 / 600);
  });

  it("falls back to an iPhone's 9 : 19.5 when there is no usable frame", () => {
    expect(frameAspect(undefined)).toBe(IPHONE_ASPECT);
    expect(frameAspect({ width: 0, height: 0 })).toBe(IPHONE_ASPECT);
    expect(frameAspect({ width: 100, height: Number.NaN })).toBe(IPHONE_ASPECT);
  });
});

describe("phoneScreenSize beside the guidance (top notch)", () => {
  it("fits the whole phone, uncropped, under the notch bar on a 1080p screen", () => {
    const screen = phoneScreenSize(ROOM_1080, frameAspect(IPHONE_15), "beside");
    expect(screen.width / screen.height).toBeCloseTo(1179 / 2556, 2);
    expect(phoneNotchHeight(screen)).toBeLessThanOrEqual(ROOM_1080.height - PHONE_LAYOUT.bottomMargin);
    expect(phoneNotchWidth(screen)).toBeLessThanOrEqual(ROOM_1080.width);
    // Much bigger than the old fixed 500 px panel.
    expect(screen.height).toBeGreaterThan(800);
  });

  it("shrinks to fit a 768 px laptop screen", () => {
    const screen = phoneScreenSize(ROOM_768, IPHONE_ASPECT, "beside");
    expect(phoneNotchHeight(screen)).toBeLessThanOrEqual(ROOM_768.height - PHONE_LAYOUT.bottomMargin);
    expect(screen.height).toBeGreaterThan(560);
  });

  it("stops at a comfortable size on a tall monitor", () => {
    expect(phoneScreenSize({ width: 840, height: 2000 }, IPHONE_ASPECT, "beside").height).toBe(PHONE_LAYOUT.maxScreenHeight);
  });

  it("is limited by width when the frame is wide", () => {
    const screen = phoneScreenSize(ROOM_1080, 3 / 4, "beside");
    expect(phoneNotchWidth(screen)).toBeLessThanOrEqual(ROOM_1080.width);
    expect(screen.width / screen.height).toBeCloseTo(3 / 4, 2);
  });

  it("never returns a negative size in a tiny room", () => {
    const screen = phoneScreenSize({ width: 100, height: 100 }, IPHONE_ASPECT, "beside");
    expect(screen.width).toBeGreaterThanOrEqual(0);
    expect(screen.height).toBeGreaterThanOrEqual(0);
  });
});

describe("phoneScreenSize stacked above the guidance (sidebar)", () => {
  it("stays inside the sidebar's width and leaves room for the guidance below", () => {
    const screen = phoneScreenSize({ width: 360, height: 1040 }, IPHONE_ASPECT, "stacked");
    expect(screen.width).toBeLessThanOrEqual(PHONE_LAYOUT.stackedMaxWidth);
    expect(screen.height).toBeLessThanOrEqual(1040 - PHONE_LAYOUT.stackedReserve);
    expect(screen.width / screen.height).toBeCloseTo(IPHONE_ASPECT, 2);
  });

  it("gives the guidance its room on a short screen", () => {
    const screen = phoneScreenSize({ width: 360, height: 728 }, IPHONE_ASPECT, "stacked");
    expect(screen.height).toBe(728 - PHONE_LAYOUT.stackedReserve);
  });
});

describe("phoneNotchWidth", () => {
  it("is the phone plus the guidance column and the panel's padding", () => {
    expect(phoneNotchWidth({ width: 400, height: 866 })).toBe(400 + PHONE_LAYOUT.sideColumn + PHONE_LAYOUT.gap + 2 * PHONE_LAYOUT.padX);
  });
});

describe("visibleRoom", () => {
  it("is the container when it is all on screen", () => {
    expect(visibleRoom({ x: 0, y: 0, width: 840, height: 1040 }, { width: 840, height: 1040 })).toEqual({ width: 840, height: 1040 });
  });

  it("drops the part of the container below the fold", () => {
    expect(visibleRoom({ x: 43, y: 70, width: 1280, height: 760 }, { width: 1366, height: 768 })).toEqual({ width: 1280, height: 698 });
  });

  it("drops the part scrolled above the top", () => {
    expect(visibleRoom({ x: 0, y: -100, width: 600, height: 760 }, { width: 1366, height: 768 })).toEqual({ width: 600, height: 660 });
  });
});

describe("markRect", () => {
  const frame = { width: 591, height: 1280 };

  it("maps frame pixels onto the displayed screen", () => {
    const display = { width: 394, height: 853 };
    const [sx, sy] = [display.width / frame.width, display.height / frame.height];
    expect(markRect({ x: 100, y: 200, width: 300, height: 80 }, frame, display)).toEqual({ x: 100 * sx, y: 200 * sy, width: 300 * sx, height: 80 * sy });
  });

  it("keeps the frame's corners on the screen's corners at any size", () => {
    for (const display of [{ width: 230, height: 500 }, { width: 394, height: 853 }]) {
      const whole = markRect({ x: 0, y: 0, ...frame }, frame, display);
      expect(whole.x).toBe(0);
      expect(whole.y).toBe(0);
      expect(whole.width).toBeCloseTo(display.width);
      expect(whole.height).toBeCloseTo(display.height);
    }
  });

  it("stays put relative to the screen when the notch grows", () => {
    const target = { x: 300, y: 900, width: 200, height: 60 };
    const small = markRect(target, frame, { width: 230, height: 500 });
    const big = markRect(target, frame, { width: 394, height: 853 });
    expect(small.x / 230).toBeCloseTo(big.x / 394, 2);
    expect(small.y / 500).toBeCloseTo(big.y / 853, 2);
  });

  it("draws nothing for an empty frame", () => {
    expect(markRect({ x: 1, y: 1, width: 1, height: 1 }, { width: 0, height: 0 }, { width: 100, height: 200 })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
