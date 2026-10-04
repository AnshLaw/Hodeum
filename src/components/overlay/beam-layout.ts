import type { Rect } from "../../lib/types";

export type Emphasis = "precise" | "broad";

/** The comet's strokes in px along the ring, tail to head. All end at the head, so it fades toward the tail. */
const COMET_PX = { tail: 110, body: 46, head: 12 } as const;
/** The comet never covers more than this share of the ring, so a small target still reads as ringed. */
const COMET_MAX_SHARE = 0.42;
/** Travel speed along the ring, so the beam moves alike round a checkbox and round a whole pane. */
const BEAM_SPEED_PX_PER_S = 260;
export const BEAM_LAP_MS = { min: 2000, max: 5200 } as const;
/** A broad (less certain) highlight is circled this much more slowly. */
const BROAD_SLOWDOWN = 1.5;
const MS_PER_S = 1000;
/** A ring hidden this recently (Hodey looked at the screen between steps) glides to the next target. */
export const GLIDE_WINDOW_MS = 8000;

export interface BeamLayout {
  /** The ring's length in px. Used as the SVG pathLength, so the dash lengths below are px too. */
  perimeter: number;
  tail: number;
  body: number;
  head: number;
  /** How long one lap of the ring takes. */
  lapMs: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Straight sides plus four quarter-circle corners, the radius capped at half the short side. SVG caps
 * each axis on its own (elliptical corners on a very flat ring), but the ring's pathLength rescales the
 * dashes to the drawn outline, so this only has to be close.
 */
export function ringPerimeter(ring: Rect, radius: number): number {
  const r = Math.min(radius, ring.width / 2, ring.height / 2);
  return 2 * (ring.width + ring.height) - (8 - 2 * Math.PI) * r;
}

export function beamLayout(ring: Rect, radius: number, emphasis: Emphasis): BeamLayout {
  if (ring.width <= 0 || ring.height <= 0) throw new Error("A beam needs a ring with a positive size");
  const perimeter = ringPerimeter(ring, radius);
  const shrink = Math.min(1, (perimeter * COMET_MAX_SHARE) / COMET_PX.tail);
  const slowdown = emphasis === "broad" ? BROAD_SLOWDOWN : 1;
  const lapMs = clamp((perimeter / BEAM_SPEED_PX_PER_S) * MS_PER_S * slowdown, BEAM_LAP_MS.min, BEAM_LAP_MS.max);
  return { perimeter, tail: COMET_PX.tail * shrink, body: COMET_PX.body * shrink, head: COMET_PX.head * shrink, lapMs };
}

export interface ShownRing {
  rect: Rect;
  /** When it left the screen; undefined while it's still showing. */
  hiddenAt?: number;
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Where a new ring should glide in from: the last ring shown, when it was on screen moments ago, so
 * the learner's eye is carried from the control they just used to the next one.
 */
export function glideOrigin(last: ShownRing | undefined, next: Rect, now: number): Rect | undefined {
  if (!last || sameRect(last.rect, next)) return undefined;
  if (last.hiddenAt !== undefined && now - last.hiddenAt > GLIDE_WINDOW_MS) return undefined;
  return last.rect;
}
