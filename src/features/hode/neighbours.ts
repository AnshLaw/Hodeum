import { center, containsPoint, intersects, padRect } from "../../lib/coords";
import type { Rect, UiElement } from "../../lib/types";

/** How far from the target a label chip can reach (its height plus the gaps around it). */
export const NEARBY_PX = 40;
/** Enough to describe a target's surroundings without flooding the overlay bus. */
export const MAX_NEIGHBOURS = 24;

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/**
 * Bounds of the on-screen elements around a target (headings, the rows beside it), so the overlay
 * can place the target's label without covering them. The target, its containers and its own parts
 * are left out: the label never covers the target anyway.
 */
export function neighboursOf(target: Rect, elements: UiElement[]): Rect[] {
  const reach = padRect(target, NEARBY_PX);
  const middle = center(target);
  return elements
    .map((e) => e.bounds)
    .filter((b) => intersects(b, reach) && !containsPoint(b, middle) && !contains(target, b))
    .slice(0, MAX_NEIGHBOURS);
}
