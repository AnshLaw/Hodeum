import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OverlayPrimitive, Rect } from "../../lib/types";
import { GuidanceLayer } from "./GuidanceLayer";
import { BADGE_RADIUS_PX, badgeCenter } from "./placement";

/** One step can light several controls: each ring carries its place in the flow as a small numbered disc. */

const SIZE = { width: 1920, height: 1080 };
const at = (x: number, y: number): Rect => ({ x, y, width: 40, height: 20 });
const render = (primitives: OverlayPrimitive[]) => renderToStaticMarkup(createElement(GuidanceLayer, { primitives, size: SIZE, keepOut: [] }));

describe("numbered highlights", () => {
  it("draws each control's number on its ring, in a hidden-from-readers layer", () => {
    const html = render([
      { kind: "highlight", bounds: at(400, 300), emphasis: "precise", label: "File", order: 1 },
      { kind: "highlight", bounds: at(600, 300), emphasis: "broad", label: "Save As", order: 2 },
    ]);
    expect(html.match(/class="order-badge"/g)).toHaveLength(2);
    expect(html).toMatch(/<text[^>]*>1<\/text>/);
    expect(html).toMatch(/<text[^>]*>2<\/text>/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*order-badge/s);
  });

  it("leaves a lone highlight unnumbered", () => {
    expect(render([{ kind: "highlight", bounds: at(400, 300), emphasis: "precise", label: "File" }])).not.toContain("order-badge");
  });
});

describe("badgeCenter", () => {
  it("sits just outside the ring's top-left corner when there's room", () => {
    const ring = at(400, 300);
    const c = badgeCenter(ring, SIZE);
    expect(c.x).toBeLessThan(ring.x);
    expect(c.y).toBeLessThan(ring.y);
    expect(c.x + BADGE_RADIUS_PX).toBeGreaterThan(ring.x - BADGE_RADIUS_PX);
  });

  it("stays whole on screen beside the overlay's edges", () => {
    for (const ring of [at(0, 0), at(SIZE.width - 10, SIZE.height - 10), at(-50, 500)]) {
      const { x, y } = badgeCenter(ring, SIZE);
      expect(x - BADGE_RADIUS_PX).toBeGreaterThanOrEqual(0);
      expect(y - BADGE_RADIUS_PX).toBeGreaterThanOrEqual(0);
      expect(x + BADGE_RADIUS_PX).toBeLessThanOrEqual(SIZE.width);
      expect(y + BADGE_RADIUS_PX).toBeLessThanOrEqual(SIZE.height);
    }
  });
});
