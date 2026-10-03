import type { MonitorInfo, Point, Rect } from "./types";

/** Physical screen pixels -> CSS pixels inside an overlay that covers `monitor`. */
export function toOverlay(rect: Rect, monitor: MonitorInfo): Rect {
  return {
    x: (rect.x - monitor.x) / monitor.scale,
    y: (rect.y - monitor.y) / monitor.scale,
    width: rect.width / monitor.scale,
    height: rect.height / monitor.scale,
  };
}

/** CSS pixels inside the overlay -> physical screen pixels. */
export function toScreen(rect: Rect, monitor: MonitorInfo): Rect {
  return {
    x: rect.x * monitor.scale + monitor.x,
    y: rect.y * monitor.scale + monitor.y,
    width: rect.width * monitor.scale,
    height: rect.height * monitor.scale,
  };
}

export function pointToScreen(point: Point, monitor: MonitorInfo): Point {
  return { x: point.x * monitor.scale + monitor.x, y: point.y * monitor.scale + monitor.y };
}

export function padRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export function area(rect: Rect): number {
  return rect.width * rect.height;
}

export function boundsOf(points: Point[]): Rect {
  if (points.length === 0) throw new Error("boundsOf needs at least one point");
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
