import { area, padRect } from "../../lib/coords";
import type { Rect, UiElement } from "../../lib/types";

/** Edges or centres this close (physical px) line up: a row of tabs, a column of list items. */
export const ALIGN_PX = 6;
/** The area's margin around the controls it groups. */
export const REGION_PADDING_PX = 8;
/** Fewer look-alikes than this around the target, and lighting the area up would give the answer away. */
const MIN_NEIGHBOURS = 2;
/** An area bigger than this share of the window doesn't say where to look. */
const MAX_WINDOW_SHARE = 0.5;
/** Roles that look alike to a learner: a ribbon mixes buttons and split buttons, a field list check boxes and tree items. */
const ROLE_FAMILIES: string[][] = [
  ["button", "split button", "menu button"],
  ["check box", "radio button"],
  ["list item", "tree item", "data item"],
];

/** The family a role belongs to, or the role alone. */
function familyOf(role: string): string[] {
  const normalized = role.toLowerCase();
  return ROLE_FAMILIES.find((family) => family.includes(normalized)) ?? [normalized];
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

const centreX = (r: Rect) => r.x + r.width / 2;
const centreY = (r: Rect) => r.y + r.height / 2;
const inRow = (a: Rect, b: Rect) => Math.abs(a.y - b.y) <= ALIGN_PX || Math.abs(centreY(a) - centreY(b)) <= ALIGN_PX;
const inColumn = (a: Rect, b: Rect) => Math.abs(a.x - b.x) <= ALIGN_PX || Math.abs(centreX(a) - centreX(b)) <= ALIGN_PX;

/** Distance between two rects along whichever axis separates them (0 when they touch or overlap). */
function gap(a: Rect, b: Rect): number {
  const dx = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const dy = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, dx, dy);
}

/** Grows an area from the target through the peers within `maxGap` of it, so only an unbroken run joins. */
function grow(start: Rect, peers: UiElement[], maxGap: number): { bounds: Rect; joined: number } {
  let bounds = start;
  const waiting = [...peers];
  let joined = 0;
  for (let added = true; added; ) {
    added = false;
    for (let i = waiting.length - 1; i >= 0; i--) {
      if (gap(bounds, waiting[i].bounds) > maxGap) continue;
      bounds = union(bounds, waiting.splice(i, 1)[0].bounds);
      joined += 1;
      added = true;
    }
  }
  return { bounds, joined };
}

/**
 * Where a hint points: the run of controls like the target that it sits among (the ribbon's tab row,
 * a dialog's buttons, a list), so the learner knows where to look without being shown which one.
 * Undefined when the target stands alone, or the area would cover most of `frame` (the window).
 */
export function regionAround(target: UiElement, elements: UiElement[], frame?: Rect): Rect | undefined {
  const family = familyOf(target.role);
  const peers = elements.filter((e) => e.id !== target.id && family.includes(e.role.toLowerCase()) && area(e.bounds) > 0);
  const maxGap = Math.max(target.bounds.width, target.bounds.height);
  const row = grow(target.bounds, peers.filter((e) => inRow(e.bounds, target.bounds)), maxGap);
  const column = grow(target.bounds, peers.filter((e) => inColumn(e.bounds, target.bounds)), maxGap);
  const best = row.joined >= column.joined ? row : column;
  if (best.joined < MIN_NEIGHBOURS) return undefined;
  const region = padRect(best.bounds, REGION_PADDING_PX);
  return frame && area(region) > area(frame) * MAX_WINDOW_SHARE ? undefined : region;
}
