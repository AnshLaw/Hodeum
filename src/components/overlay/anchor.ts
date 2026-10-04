import type { OverlayPrimitive, Point, Rect, WindowRef } from "../../lib/types";

/** Frame sizes from two reads of the same window can differ by rounding; anything more is a resize. */
const RESIZE_TOLERANCE_PX = 1;

export interface AnchoredScene {
  primitives: OverlayPrimitive[];
  /** The window they belong to (physical screen px); nothing is drawn outside it. */
  clip?: Rect;
}

const shift = (r: Rect, by: Point): Rect => ({ ...r, x: r.x + by.x, y: r.y + by.y });

function shifted(primitive: OverlayPrimitive, by: Point): OverlayPrimitive {
  if (by.x === 0 && by.y === 0) return primitive;
  if (primitive.kind === "arrow") return { ...primitive, to: shift(primitive.to, by) };
  if (primitive.kind === "highlight" && primitive.keepClear) {
    return { ...primitive, bounds: shift(primitive.bounds, by), keepClear: primitive.keepClear.map((r) => shift(r, by)) };
  }
  return { ...primitive, bounds: shift(primitive.bounds, by) };
}

const resized = (was: Rect, now: Rect) =>
  Math.abs(was.width - now.width) > RESIZE_TOLERANCE_PX || Math.abs(was.height - now.height) > RESIZE_TOLERANCE_PX;

/** How far `anchor` has moved since it was read, or undefined when it isn't the front window as it was. */
function offsetOf(anchor: WindowRef, front: WindowRef | null | undefined): Point | undefined {
  if (front === undefined) return { x: 0, y: 0 };
  if (front === null || front.id !== anchor.id || resized(anchor.bounds, front.bounds)) return undefined;
  return { x: front.bounds.x - anchor.bounds.x, y: front.bounds.y - anchor.bounds.y };
}

/**
 * Guidance is drawn only over the window it was placed on, while that window is the learner's front
 * window: it follows the window when it moves, hides once it's resized (re-observing redraws it), and
 * is clipped to the window so a ring or dim never spills onto another app.
 * `anchor`: the window the guidance was placed on (a mark carries its own); `front`: the learner's
 * front window, null when none (desktop, minimized), undefined until the native side has said.
 */
export function anchorPrimitives(primitives: OverlayPrimitive[], anchor: WindowRef | undefined, front: WindowRef | null | undefined): AnchoredScene {
  let clip: Rect | undefined;
  const shown = primitives.flatMap((primitive) => {
    const own = (primitive.kind === "pin" ? primitive.window : undefined) ?? anchor;
    if (!own) return [primitive];
    const offset = offsetOf(own, front);
    if (!offset) return [];
    clip = front?.bounds ?? own.bounds;
    return [shifted(primitive, offset)];
  });
  return clip ? { primitives: shown, clip } : { primitives: shown };
}
