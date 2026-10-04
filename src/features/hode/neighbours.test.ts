import { describe, expect, it } from "vitest";
import type { Rect, UiElement } from "../../lib/types";
import { MAX_NEIGHBOURS, NEARBY_PX, neighboursOf } from "./neighbours";

const el = (name: string, bounds: Rect): UiElement => ({ id: name, name, role: "text", bounds, source: "uia", confidence: 1 });
const ROW: Rect = { x: 100, y: 200, width: 240, height: 30 };

describe("neighboursOf", () => {
  it("returns text just above and below the target", () => {
    const heading = el("PivotTable Fields", { x: 100, y: 170, width: 140, height: 20 });
    const next = el("Product", { x: 100, y: 236, width: 240, height: 30 });
    expect(neighboursOf(ROW, [heading, next])).toEqual([heading.bounds, next.bounds]);
  });

  it("skips the target itself, what contains it, and what sits inside it", () => {
    const self = el("Region", ROW);
    const pane = el("Fields pane", { x: 80, y: 100, width: 300, height: 600 });
    const checkbox = el("Region checkbox", { x: 104, y: 207, width: 16, height: 16 });
    expect(neighboursOf(ROW, [self, pane, checkbox])).toEqual([]);
  });

  it("ignores elements farther away than the chip could reach", () => {
    const far = el("Far", { x: 100, y: ROW.y - NEARBY_PX - 30, width: 100, height: 20 });
    expect(neighboursOf(ROW, [far])).toEqual([]);
  });

  it("keeps the payload small on a crowded screen", () => {
    const crowd = Array.from({ length: MAX_NEIGHBOURS + 10 }, (_, i) => el(`cell ${i}`, { x: 100 + i * 4, y: 176, width: 20, height: 20 }));
    expect(neighboursOf(ROW, crowd)).toHaveLength(MAX_NEIGHBOURS);
  });
});
