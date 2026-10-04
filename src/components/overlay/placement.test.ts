import { describe, expect, it } from "vitest";
import { center, intersects, toOverlay, toScreen } from "../../lib/coords";
import type { MonitorInfo, Point, Rect, Size } from "../../lib/types";
import { ARROW_GAP_PX, LABEL_GAP_PX, TARGET_CLEARANCE_PX, type ArrowGeometry, approachSide, arrowBounds, arrowGeometry, labelPosition, pulseScale } from "./placement";

const viewport: Size = { width: 1000, height: 800 };
const chip: Size = { width: 70, height: 26 };
const DEGREES_PER_RADIAN = 180 / Math.PI;
const AIM_TOLERANCE_DEG = 0.5;
const FULL_TURN_DEG = 360;
/** Where the DPI test target sits, as a fraction of the monitor. */
const TARGET_FRACTION = 0.8;

function must(arrow: ArrowGeometry | undefined): ArrowGeometry {
  if (!arrow) throw new Error("expected an arrow");
  return arrow;
}

function aimError(arrow: ArrowGeometry, target: Rect): number {
  const c = center(target);
  const toCenter = Math.atan2(c.y - arrow.end.y, c.x - arrow.end.x) * DEGREES_PER_RADIAN;
  return Math.abs(((toCenter - arrow.angle + FULL_TURN_DEG * 1.5) % FULL_TURN_DEG) - FULL_TURN_DEG / 2);
}

/** Distance from a point outside a rect to the rect's nearest edge. */
function gapTo(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

function inside(point: Point, size: Size): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
}

function expectWellAimed(target: Rect, size: Size = viewport): ArrowGeometry {
  const arrow = must(arrowGeometry(target, size));
  expect(aimError(arrow, target)).toBeLessThan(AIM_TOLERANCE_DEG);
  expect(gapTo(arrow.end, target)).toBeCloseTo(ARROW_GAP_PX);
  expect(intersects(arrowBounds(arrow), target)).toBe(false);
  expect(inside(arrow.start, size)).toBe(true);
  expect(inside(arrow.control, size)).toBe(true);
  return arrow;
}

describe("approachSide", () => {
  it("comes from the side with the most free space", () => {
    expect(approachSide({ x: 900, y: 380, width: 60, height: 40 }, viewport)).toBe("left");
    expect(approachSide({ x: 20, y: 380, width: 60, height: 40 }, viewport)).toBe("right");
    expect(approachSide({ x: 470, y: 10, width: 60, height: 30 }, viewport)).toBe("bottom");
    expect(approachSide({ x: 470, y: 760, width: 60, height: 30 }, viewport)).toBe("top");
  });
});

describe("arrowGeometry", () => {
  it("approaches a top-edge target from below, tip just under its bottom edge", () => {
    const target = { x: 480, y: 10, width: 40, height: 20 };
    const arrow = expectWellAimed(target);
    expect(arrow.start.y).toBeGreaterThan(arrow.end.y);
    expect(arrow.end).toEqual({ x: 500, y: 30 + ARROW_GAP_PX });
  });

  it("approaches a bottom-edge target from above", () => {
    const arrow = expectWellAimed({ x: 480, y: 770, width: 40, height: 20 });
    expect(arrow.side).toBe("top");
    expect(arrow.start.y).toBeLessThan(arrow.end.y);
  });

  it("approaches a left-edge target from the right", () => {
    const arrow = expectWellAimed({ x: 4, y: 390, width: 30, height: 20 });
    expect(arrow.side).toBe("right");
    expect(arrow.end).toEqual({ x: 34 + ARROW_GAP_PX, y: 400 });
  });

  it("approaches a right-edge pane row from the left, aimed at its middle (the PivotTable field case)", () => {
    const row = { x: 976, y: 238, width: 252, height: 36 };
    const arrow = expectWellAimed(row, { width: 1280, height: 760 });
    expect(arrow.side).toBe("left");
    expect(arrow.end).toEqual({ x: 976 - ARROW_GAP_PX, y: 256 });
  });

  it("approaches a menu item from the side so it never crosses the items below it", () => {
    const item = { x: 430, y: 330, width: 216, height: 34 };
    const arrow = expectWellAimed(item, { width: 1280, height: 760 });
    expect(["left", "right"]).toContain(arrow.side);
  });

  it("approaches a tall, narrow target (a scrollbar) from above or below", () => {
    const scrollbar = { x: 700, y: 200, width: 14, height: 300 };
    expect(["top", "bottom"]).toContain(expectWellAimed(scrollbar).side);
  });

  it("lands just outside a small checkbox", () => {
    const checkbox = { x: 600, y: 300, width: 16, height: 16 };
    const arrow = expectWellAimed(checkbox);
    expect(gapTo(arrow.end, checkbox)).toBeCloseTo(ARROW_GAP_PX);
  });

  it("aims at the middle of a wide ribbon tab near the top", () => {
    const tab = { x: 120, y: 40, width: 90, height: 28 };
    const arrow = expectWellAimed(tab);
    expect(arrow.side).toBe("bottom");
    expect(arrow.end.x).toBe(165);
  });

  it("aims at the visible part of a target clipped by the screen edge", () => {
    const arrow = expectWellAimed({ x: 980, y: 300, width: 100, height: 40 });
    expect(arrow.side).toBe("left");
    expect(arrow.end).toEqual({ x: 980 - ARROW_GAP_PX, y: 320 });
  });

  it("draws nothing for an off-screen target or one with no room around it", () => {
    expect(arrowGeometry({ x: 1200, y: 300, width: 40, height: 40 }, viewport)).toBeUndefined();
    expect(arrowGeometry({ x: 4, y: 4, width: 992, height: 792 }, viewport)).toBeUndefined();
  });

  it("comes from another side when the roomiest one runs under the notch", () => {
    const list = { x: 250, y: 240, width: 1010, height: 560 };
    const notch = { x: 392, y: 0, width: 496, height: 160 };
    const size = { width: 1280, height: 800 };
    expect(must(arrowGeometry(list, size)).side).toBe("top");
    const arrow = must(arrowGeometry(list, size, [notch]));
    expect(arrow.side).not.toBe("top");
    expect(intersects(arrowBounds(arrow), notch)).toBe(false);
  });

  it("draws no arrow rather than one under the notch when every side that fits is blocked", () => {
    const target = { x: 480, y: 380, width: 40, height: 40 };
    const everywhere = { x: 0, y: 0, width: 1000, height: 800 };
    expect(arrowGeometry(target, viewport, [everywhere])).toBeUndefined();
  });

  it("omits the arrow for a huge target whose only roomy side runs under the notch (the Explorer list case)", () => {
    const list = { x: 30, y: 184, width: 1220, height: 548 };
    const notch = { x: 392, y: 0, width: 496, height: 160 };
    expect(arrowGeometry(list, { width: 1280, height: 760 }, [notch])).toBeUndefined();
  });

  it("shortens to fit when the free side is tight but still usable", () => {
    const arrow = expectWellAimed({ x: 60, y: 60, width: 880, height: 680 });
    expect(arrow.start.x).toBeGreaterThanOrEqual(0);
  });
});

describe("arrows through the DPI pipeline", () => {
  const cases: { name: string; monitor: MonitorInfo }[] = [
    { name: "125%", monitor: { x: 1920, y: 0, width: 2400, height: 1500, scale: 1.25 } },
    { name: "150%", monitor: { x: 0, y: 0, width: 2880, height: 1800, scale: 1.5 } },
  ];
  for (const { name, monitor } of cases) {
    it(`keeps the tip a fixed CSS gap outside the physical target at ${name}`, () => {
      const physical = { x: monitor.x + monitor.width * TARGET_FRACTION, y: monitor.y + monitor.height * TARGET_FRACTION, width: 24, height: 24 };
      const size = { width: monitor.width / monitor.scale, height: monitor.height / monitor.scale };
      const local = toOverlay(physical, monitor);
      const arrow = expectWellAimed(local, size);
      const tip = toScreen({ ...arrow.end, width: 0, height: 0 }, monitor);
      expect(gapTo(tip, physical)).toBeCloseTo(ARROW_GAP_PX * monitor.scale);
    });
  }
});

describe("labelPosition", () => {
  const row = { x: 976, y: 238, width: 252, height: 36 };
  const stage = { width: 1280, height: 760 };
  const chipAt = (at: Point): Rect => ({ ...at, ...chip });

  it("sits on the box's top edge at its end: over the ring, never inside the target", () => {
    const arrow = must(arrowGeometry(row, stage));
    const rect = chipAt(labelPosition({ target: row, chip, viewport: stage, arrow, avoid: [] }));
    expect(rect.y + rect.height).toBe(row.y);
    expect(rect.y + rect.height).toBeGreaterThan(row.y - TARGET_CLEARANCE_PX - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(row.x + row.width);
    expect(rect.x).toBeGreaterThan(row.x + row.width / 2);
    expect(intersects(rect, row)).toBe(false);
    expect(intersects(rect, arrowBounds(arrow))).toBe(false);
  });

  it("moves to the bottom edge when the top edge would cover nearby text", () => {
    const heading = { x: row.x, y: row.y - 30, width: row.width, height: 24 };
    const rect = chipAt(labelPosition({ target: row, chip, viewport: stage, avoid: [heading] }));
    expect(rect.y).toBe(row.y + row.height);
    expect(intersects(rect, heading)).toBe(false);
    expect(intersects(rect, row)).toBe(false);
  });

  it("tries the other end of the top edge before giving up on it", () => {
    const corner = { x: row.x + row.width - 90, y: row.y - 30, width: 90, height: 24 };
    const rect = chipAt(labelPosition({ target: row, chip, viewport: stage, avoid: [corner] }));
    expect(rect.y + rect.height).toBe(row.y);
    expect(rect.x).toBeLessThan(row.x + row.width / 2);
    expect(intersects(rect, corner)).toBe(false);
  });

  it("goes beside the target when text sits on both edges", () => {
    const above = { x: row.x, y: row.y - 30, width: row.width, height: 24 };
    const below = { x: row.x, y: row.y + row.height + 2, width: row.width, height: 30 };
    const rect = chipAt(labelPosition({ target: row, chip, viewport: stage, avoid: [above, below] }));
    expect([above, below, row].some((r) => intersects(rect, r))).toBe(false);
    expect(rect.x + rect.width).toBeLessThanOrEqual(row.x - LABEL_GAP_PX);
  });

  it("never sits under the notch, even when nothing else fits", () => {
    const tab = { x: 420, y: 150, width: 90, height: 28 };
    const notch = { x: 392, y: 0, width: 496, height: 160 };
    const crowd = [{ x: 0, y: 178, width: 1280, height: 582 }];
    const rect = chipAt(labelPosition({ target: tab, chip, viewport: stage, avoid: crowd, keepOut: [notch] }));
    expect(intersects(rect, notch)).toBe(false);
    expect(intersects(rect, tab)).toBe(false);
  });

  it("when every spot covers something, takes the one that covers least", () => {
    const item = { x: 500, y: 300, width: 200, height: 30 };
    const covers = (rect: Rect, zone: Rect) => intersects(rect, zone);
    const above = { x: 400, y: 200, width: 400, height: 98 };
    const besides = [{ x: 300, y: 250, width: 196, height: 130 }, { x: 704, y: 250, width: 296, height: 130 }];
    // Only the top few pixels of whatever is below reach the bottom edge's chip.
    const below = { x: 400, y: 352, width: 400, height: 60 };
    const rect = chipAt(labelPosition({ target: item, chip, viewport, avoid: [above, below, ...besides] }));
    expect(covers(rect, above)).toBe(false);
    expect(besides.some((b) => covers(rect, b))).toBe(false);
    expect(rect.y).toBe(item.y + item.height);
  });

  it("centres on a target narrower than the chip", () => {
    const checkbox = { x: 600, y: 300, width: 16, height: 16 };
    const rect = chipAt(labelPosition({ target: checkbox, chip, viewport, avoid: [] }));
    expect(rect.x + rect.width / 2).toBeCloseTo(checkbox.x + checkbox.width / 2);
    expect(rect.y + rect.height).toBe(checkbox.y);
  });

  it("stays on-screen next to a corner target", () => {
    const corner = { x: 2, y: 2, width: 20, height: 20 };
    const at = labelPosition({ target: corner, chip, viewport, avoid: [] });
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(intersects({ ...at, ...chip }, corner)).toBe(false);
  });

  it("steps around other primitives", () => {
    const target = { x: 600, y: 380, width: 40, height: 40 };
    const blocker = { x: 450, y: 360, width: 140, height: 80 };
    const at = labelPosition({ target, chip, viewport, avoid: [blocker] });
    expect(intersects({ ...at, ...chip }, blocker)).toBe(false);
    expect(intersects({ ...at, ...chip }, target)).toBe(false);
  });
});

describe("pulseScale", () => {
  it("grows every side by the same distance, even for a wide row", () => {
    const ring = { x: 100, y: 100, width: 260, height: 40 };
    const spread = 8;
    const { x, y } = pulseScale(ring, spread);
    expect((ring.width * x - ring.width) / 2).toBeCloseTo(spread);
    expect((ring.height * y - ring.height) / 2).toBeCloseTo(spread);
  });

  it("rejects an empty ring instead of dividing by zero", () => {
    expect(() => pulseScale({ x: 0, y: 0, width: 0, height: 10 }, 8)).toThrow();
  });
});
