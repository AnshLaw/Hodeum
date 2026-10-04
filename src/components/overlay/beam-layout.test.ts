import { describe, expect, it } from "vitest";
import type { Rect } from "../../lib/types";
import { BEAM_LAP_MS, GLIDE_WINDOW_MS, beamLayout, glideOrigin, ringPerimeter } from "./beam-layout";

const RADIUS = 8;
const button: Rect = { x: 100, y: 100, width: 200, height: 80 };
const checkbox: Rect = { x: 40, y: 40, width: 24, height: 24 };
const pane: Rect = { x: 0, y: 0, width: 900, height: 700 };

describe("ringPerimeter", () => {
  it("measures straight sides plus four quarter-circle corners", () => {
    expect(ringPerimeter({ x: 0, y: 0, width: 100, height: 40 }, RADIUS)).toBeCloseTo(2 * 140 - (8 - 2 * Math.PI) * RADIUS);
  });

  it("caps the corner radius at half the short side, like SVG does", () => {
    const stadium = 2 * (20 - 10) + Math.PI * 10;
    expect(ringPerimeter({ x: 0, y: 0, width: 20, height: 10 }, RADIUS)).toBeCloseTo(stadium);
  });
});

describe("beamLayout", () => {
  it("draws the comet tail, body and head at full length on a roomy ring", () => {
    const layout = beamLayout(button, RADIUS, "precise");
    expect(layout.perimeter).toBeCloseTo(ringPerimeter(button, RADIUS));
    expect(layout.tail).toBeGreaterThan(layout.body);
    expect(layout.body).toBeGreaterThan(layout.head);
    expect(layout.tail).toBeLessThan(layout.perimeter / 2);
  });

  it("shrinks the comet on a tiny ring so the ring still reads as a ring", () => {
    const roomy = beamLayout(button, RADIUS, "precise");
    const tiny = beamLayout(checkbox, RADIUS, "precise");
    expect(tiny.tail).toBeLessThan(tiny.perimeter / 2);
    expect(tiny.tail).toBeLessThan(roomy.tail);
    expect(tiny.head / tiny.tail).toBeCloseTo(roomy.head / roomy.tail);
  });

  it("keeps laps within bounds: calm on small targets, never sluggish on big ones", () => {
    expect(beamLayout(checkbox, RADIUS, "precise").lapMs).toBe(BEAM_LAP_MS.min);
    expect(beamLayout(pane, RADIUS, "precise").lapMs).toBe(BEAM_LAP_MS.max);
  });

  it("circles a broad (less certain) highlight more slowly", () => {
    const mid: Rect = { x: 0, y: 0, width: 300, height: 160 };
    expect(beamLayout(mid, RADIUS, "broad").lapMs).toBeGreaterThan(beamLayout(mid, RADIUS, "precise").lapMs);
  });

  it("refuses a ring with no size", () => {
    expect(() => beamLayout({ x: 0, y: 0, width: 0, height: 20 }, RADIUS, "precise")).toThrow();
  });
});

describe("glideOrigin", () => {
  const now = 50_000;
  const next: Rect = { x: 400, y: 300, width: 90, height: 30 };

  it("has nowhere to glide from on the first highlight", () => {
    expect(glideOrigin(undefined, next, now)).toBeUndefined();
  });

  it("glides from a ring that is still on screen", () => {
    expect(glideOrigin({ rect: button }, next, now)).toEqual(button);
  });

  it("glides from a ring hidden moments ago, while Hodey looked at the screen", () => {
    expect(glideOrigin({ rect: button, hiddenAt: now - GLIDE_WINDOW_MS / 2 }, next, now)).toEqual(button);
  });

  it("starts fresh once the last ring has been gone a while", () => {
    expect(glideOrigin({ rect: button, hiddenAt: now - GLIDE_WINDOW_MS - 1 }, next, now)).toBeUndefined();
  });

  it("doesn't glide onto the same spot; the ring locks on again instead", () => {
    expect(glideOrigin({ rect: next, hiddenAt: now - 10 }, { ...next }, now)).toBeUndefined();
  });
});
