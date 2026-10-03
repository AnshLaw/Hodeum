import { intersects } from "../../lib/coords";
import type { OverlayPrimitive, Rect } from "../../lib/types";
import { NOTCH_WIDTHS } from "./notch-view";

/** Height of the expanded guidance card in CSS px (bar + two text lines + controls), rounded up. */
export const GUIDANCE_CARD_HEIGHT = 160;

export interface WindowOrigin {
  /** Physical screen position of the notch window's top-left. */
  x: number;
  y: number;
  scale: number;
}

/** Screen area (physical px) the expanded top notch card covers, independent of its current size. */
export function guidanceFootprint(origin: WindowOrigin, windowWidthCss: number): Rect {
  const width = NOTCH_WIDTHS.guidance;
  const left = (windowWidthCss - width) / 2;
  return {
    x: origin.x + left * origin.scale,
    y: origin.y,
    width: width * origin.scale,
    height: GUIDANCE_CARD_HEIGHT * origin.scale,
  };
}

/** True when a highlighted target would sit under the expanded card. */
export function coversTarget(footprint: Rect, primitives: OverlayPrimitive[]): boolean {
  return primitives.some((p) => p.kind === "highlight" && intersects(p.bounds, footprint));
}
