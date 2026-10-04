import { intersects } from "../../lib/coords";
import type { OverlayPrimitive, Rect } from "../../lib/types";
import { NOTCH_WIDTHS } from "./notch-view";

/** Height of the expanded guidance card in CSS px (bar + two text lines + controls), until it's measured. */
export const GUIDANCE_CARD_HEIGHT = 160;
/** The highlight ring and its pulse reach this far past the target: the card steps aside before touching them. */
export const TARGET_RING_REACH_PX = 12;

export interface WindowOrigin {
  /** Physical screen position of the notch window's top-left. */
  x: number;
  y: number;
  scale: number;
}

/**
 * Screen area (physical px) the expanded top notch card covers, independent of its current size.
 * `cardBottom` is the card's measured bottom in the notch window (CSS px) once it has been shown.
 */
export function guidanceFootprint(origin: WindowOrigin, windowWidthCss: number, cardBottom = GUIDANCE_CARD_HEIGHT): Rect {
  const width = NOTCH_WIDTHS.guidance;
  const left = (windowWidthCss - width) / 2;
  return {
    x: origin.x + left * origin.scale,
    y: origin.y,
    width: width * origin.scale,
    height: (cardBottom + TARGET_RING_REACH_PX) * origin.scale,
  };
}

/** The notch surface's box (CSS px in the notch window) in physical screen pixels, for the overlay. */
export function notchScreenRect(local: Rect, origin: WindowOrigin): Rect {
  return { x: origin.x + local.x * origin.scale, y: origin.y + local.y * origin.scale, width: local.width * origin.scale, height: local.height * origin.scale };
}

/** True when a highlighted target would sit under the expanded card. */
export function coversTarget(footprint: Rect, primitives: OverlayPrimitive[]): boolean {
  return primitives.some((p) => p.kind === "highlight" && intersects(p.bounds, footprint));
}
