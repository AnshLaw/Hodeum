import { boundsOf, pointToScreen, toOverlay, toScreen } from "../../lib/coords";
import type { AnnotationShape, MonitorInfo, OverlayPrimitive, Point, Rect, Size } from "../../lib/types";

export const CLICK_SLOP_PX = 6;
export const POINT_BOX_PX = 48;
const COMPOSER_GAP_PX = 12;
const VIEWPORT_MARGIN_PX = 12;

/** A near-stationary press is a point; Shift-drawing is a freehand circle; otherwise a dragged rectangle. */
export function shapeFromGesture(points: Point[], freehand: boolean): AnnotationShape {
  if (points.length === 0) throw new Error("A gesture needs at least one point");
  const bounds = boundsOf(points);
  if (bounds.width <= CLICK_SLOP_PX && bounds.height <= CLICK_SLOP_PX) {
    const at = points[0];
    const half = POINT_BOX_PX / 2;
    return { kind: "point", at, bounds: { x: at.x - half, y: at.y - half, width: POINT_BOX_PX, height: POINT_BOX_PX } };
  }
  if (freehand) return { kind: "stroke", points, bounds };
  return { kind: "rect", bounds: boundsOf([points[0], points[points.length - 1]]) };
}

export function shapeToScreen(shape: AnnotationShape, monitor: MonitorInfo): AnnotationShape {
  const bounds = toScreen(shape.bounds, monitor);
  switch (shape.kind) {
    case "rect":
      return { kind: "rect", bounds };
    case "point":
      return { kind: "point", at: pointToScreen(shape.at, monitor), bounds };
    case "stroke":
      return { kind: "stroke", points: shape.points.map((p) => pointToScreen(p, monitor)), bounds };
  }
}

export function primitiveToOverlay(primitive: OverlayPrimitive, monitor: MonitorInfo): OverlayPrimitive {
  if (primitive.kind === "arrow") return { ...primitive, to: toOverlay(primitive.to, monitor) };
  return { ...primitive, bounds: toOverlay(primitive.bounds, monitor) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Beside the mark (right, else left, else below), always fully on-screen. */
export function composerPosition(anchor: Rect, viewport: Size, composer: Size): Point {
  const right = anchor.x + anchor.width + COMPOSER_GAP_PX;
  const left = anchor.x - COMPOSER_GAP_PX - composer.width;
  let x = anchor.x;
  let y = anchor.y + anchor.height + COMPOSER_GAP_PX;
  if (right + composer.width <= viewport.width - VIEWPORT_MARGIN_PX) [x, y] = [right, anchor.y];
  else if (left >= VIEWPORT_MARGIN_PX) [x, y] = [left, anchor.y];
  return {
    x: clamp(x, VIEWPORT_MARGIN_PX, viewport.width - composer.width - VIEWPORT_MARGIN_PX),
    y: clamp(y, VIEWPORT_MARGIN_PX, viewport.height - composer.height - VIEWPORT_MARGIN_PX),
  };
}

export function roundedRectPath({ x, y, width: w, height: h }: Rect, radius: number): string {
  const r = Math.min(radius, w / 2, h / 2);
  return [
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join("");
}
