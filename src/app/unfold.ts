import type { Rect } from "../lib/types";

const UNFOLD_MS = 460;
const FOLD_MS = 320;
const START_RADIUS = 18;
const END_RADIUS = 12;
/** Without a notch to grow from (or with reduced motion) the app simply fades. */
const FADE_IN_MS = 160;
const FADE_OUT_MS = 140;

type Size = { width: number; height: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The notch's rect moved (and if need be shrunk) to lie inside the window. The app usually sits below
 * the notch or beside a sidebar, so the raw rect is partly or wholly outside; cropping to it would show
 * nothing. Sliding it onto the nearest edge keeps the app visibly growing out of where the notch was.
 */
export function fitInside(from: Rect, size: Size): Rect {
  const width = clamp(from.width, 0, size.width);
  const height = clamp(from.height, 0, size.height);
  return { x: clamp(from.x, 0, size.width - width), y: clamp(from.y, 0, size.height - height), width, height };
}

/** Insets that crop an element of `size` down to `from` (a rect in the element's own coordinates). */
export function insetsFor(from: Rect, size: Size): string {
  const rect = fitInside(from, size);
  const right = size.width - (rect.x + rect.width);
  const bottom = size.height - (rect.y + rect.height);
  return `inset(${rect.y}px ${right}px ${bottom}px ${rect.x}px round ${START_RADIUS}px)`;
}

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The notch grows into the app: the app reveals itself outward from where the notch was. */
export function unfold(element: HTMLElement, from: Rect | undefined): Animation {
  const size = { width: element.clientWidth, height: element.clientHeight };
  if (!from || reduced()) return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS });
  return element.animate(
    [
      { clipPath: insetsFor(from, size), opacity: 0.85 },
      { clipPath: `inset(0px 0px 0px 0px round ${END_RADIUS}px)`, opacity: 1 },
    ],
    { duration: UNFOLD_MS, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  );
}

/** The reverse: the app folds back into the notch before it hides. */
export function fold(element: HTMLElement, to: Rect | undefined): Animation {
  const size = { width: element.clientWidth, height: element.clientHeight };
  if (!to || reduced()) return element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, fill: "forwards" });
  return element.animate(
    [
      { clipPath: `inset(0px 0px 0px 0px round ${END_RADIUS}px)`, opacity: 1 },
      { clipPath: insetsFor(to, size), opacity: 0 },
    ],
    { duration: FOLD_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
  );
}
