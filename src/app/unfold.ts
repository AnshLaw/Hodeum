import type { Rect } from "../lib/types";

const UNFOLD_MS = 460;
const FOLD_MS = 320;
const START_RADIUS = 18;
const END_RADIUS = 12;

/** Insets that crop `element` down to `from` (a rect in the element's own coordinates). */
export function insetsFor(from: Rect, size: { width: number; height: number }): string {
  const top = Math.max(0, from.y);
  const left = Math.max(0, from.x);
  const right = Math.max(0, size.width - (from.x + from.width));
  const bottom = Math.max(0, size.height - (from.y + from.height));
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${START_RADIUS}px)`;
}

function reduced(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The notch grows into the app: the app reveals itself outward from where the notch was. */
export function unfold(element: HTMLElement, from: Rect | undefined): Animation {
  const size = { width: element.clientWidth, height: element.clientHeight };
  if (!from || reduced()) return element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
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
  if (!to || reduced()) return element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
  return element.animate(
    [
      { clipPath: `inset(0px 0px 0px 0px round ${END_RADIUS}px)`, opacity: 1 },
      { clipPath: insetsFor(to, size), opacity: 0 },
    ],
    { duration: FOLD_MS, easing: "cubic-bezier(0.5, 0, 0.75, 0)", fill: "forwards" },
  );
}
