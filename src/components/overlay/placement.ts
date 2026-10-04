import { boundsOf, center, intersects, padRect } from "../../lib/coords";
import type { Point, Rect, Size } from "../../lib/types";

/** Tip-to-target distance: just outside the highlight ring and the spotlight hole. */
export const ARROW_GAP_PX = 12;
export const ARROW_HEAD_PX = 13;
/** Half the arrowhead's width: what the drawn arrow occupies either side of its path. */
const ARROW_HALF_WIDTH_PX = 8;
const ARROW_LENGTH_PX = 72;
const ARROW_MIN_LENGTH_PX = 32;
const ARROW_BEND = 0.25;
/** Arrows and labels keep this far from the monitor edge. */
const VIEWPORT_MARGIN_PX = 8;
export const LABEL_GAP_PX = 8;
/** The highlight ring's outset from the target. */
export const TARGET_CLEARANCE_PX = 4;
/** An attached chip's bottom (or top) sits this far over the ring: on the border, never inside the target. */
const ATTACH_OVERLAP_PX = TARGET_CLEARANCE_PX;
/** Attached chips keep clear of the ring's rounded corners. */
const ATTACH_CORNER_INSET_PX = 10;
const DEGREES_PER_RADIAN = 180 / Math.PI;
/** Width-to-height ratio past which a target reads as a row (a menu item, a list entry). */
const ROW_ASPECT = 4;

export type Side = "left" | "right" | "top" | "bottom";
/** Preference order when two sides have equal room. */
const SIDES: Side[] = ["left", "right", "bottom", "top"];
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };
/** Unit vector pointing out of the target through each side. */
const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

export interface ArrowGeometry {
  side: Side;
  start: Point;
  control: Point;
  /** The tip: just outside the target's edge. */
  end: Point;
  /** Where the shaft meets the arrowhead's base, so the line never pokes past the tip. */
  shaftEnd: Point;
  /** Direction of travel at the tip, in degrees; it points at the target's centre. */
  angle: number;
}

/** The part of `rect` on screen, or undefined when none of it is. */
export function visiblePart(rect: Rect, viewport: Size): Rect | undefined {
  const x = Math.max(rect.x, 0);
  const y = Math.max(rect.y, 0);
  const right = Math.min(rect.x + rect.width, viewport.width);
  const bottom = Math.min(rect.y + rect.height, viewport.height);
  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

export function freeSpace(target: Rect, viewport: Size): Record<Side, number> {
  return {
    left: target.x,
    right: viewport.width - (target.x + target.width),
    top: target.y,
    bottom: viewport.height - (target.y + target.height),
  };
}

const isHorizontal = (side: Side) => side === "left" || side === "right";

/**
 * Sides ordered from most to least room, as a share of the screen along that axis, so a wide
 * monitor doesn't always favour left/right: the arrow comes in from the open middle of the screen.
 * Row-shaped targets put the two sides at the ends of the row first.
 */
function sidesByRoom(target: Rect, viewport: Size): Side[] {
  const free = freeSpace(target, viewport);
  const share = (side: Side) => free[side] / (isHorizontal(side) ? viewport.width : viewport.height);
  const byRoom = [...SIDES].sort((a, b) => share(b) - share(a));
  const axis = rowAxis(target);
  if (!axis) return byRoom;
  // Rows sit in stacks (menus, lists, field panes): come in along the row, not across its neighbours.
  return [...byRoom.filter((s) => isHorizontal(s) === (axis === "x")), ...byRoom.filter((s) => isHorizontal(s) !== (axis === "x"))];
}

/** The long axis of a row- or column-shaped target, or undefined for anything squarer. */
function rowAxis(target: Rect): "x" | "y" | undefined {
  if (target.width >= target.height * ROW_ASPECT) return "x";
  if (target.height >= target.width * ROW_ASPECT) return "y";
  return undefined;
}

/** The preferred side: where an arrow comes from when nothing is in its way. */
export function approachSide(target: Rect, viewport: Size): Side {
  return sidesByRoom(target, viewport)[0];
}

function edgeMidpoint(rect: Rect, side: Side): Point {
  const c = center(rect);
  if (side === "left") return { x: rect.x, y: c.y };
  if (side === "right") return { x: rect.x + rect.width, y: c.y };
  if (side === "top") return { x: c.x, y: rect.y };
  return { x: c.x, y: rect.y + rect.height };
}

const along = (from: Point, dir: Point, distance: number): Point => ({ x: from.x + dir.x * distance, y: from.y + dir.y * distance });

/** +1 or -1: which way the curve bows so its tail swings toward the middle of the screen. */
function bowToward(end: Point, dir: Point, viewport: Size): Point {
  const perp = { x: -dir.y, y: dir.x };
  const toMiddle = (viewport.width / 2 - end.x) * perp.x + (viewport.height / 2 - end.y) * perp.y;
  return toMiddle < 0 ? { x: -perp.x, y: -perp.y } : perp;
}

function arrowFrom(visible: Rect, side: Side, viewport: Size): ArrowGeometry | undefined {
  const length = Math.min(ARROW_LENGTH_PX, freeSpace(visible, viewport)[side] - ARROW_GAP_PX - VIEWPORT_MARGIN_PX);
  if (length < ARROW_MIN_LENGTH_PX) return undefined;
  const dir = OUTWARD[side];
  const end = along(edgeMidpoint(visible, side), dir, ARROW_GAP_PX);
  const control = along(end, dir, length / 2);
  const start = along(along(end, dir, length), bowToward(end, dir, viewport), length * ARROW_BEND);
  const angle = Math.atan2(-dir.y, -dir.x) * DEGREES_PER_RADIAN;
  return { side, start, control, end, shaftEnd: along(end, dir, ARROW_HEAD_PX), angle };
}

/**
 * A short curved arrow from the side with the most room that doesn't run into `avoid` (the notch,
 * say). The tip lands just outside the middle of that edge and points straight at the target's
 * centre. Undefined when the target is off-screen or every side with room runs into `avoid`:
 * an arrow hidden under the notch is worse than none, and the highlight still shows the target.
 */
export function arrowGeometry(target: Rect, viewport: Size, avoid: Rect[] = []): ArrowGeometry | undefined {
  const visible = visiblePart(target, viewport);
  if (!visible) return undefined;
  const fitting = sidesByRoom(visible, viewport).flatMap((side) => arrowFrom(visible, side, viewport) ?? []);
  return fitting.find((arrow) => !avoid.some((zone) => intersects(arrowBounds(arrow), zone)));
}

/** Everything the drawn arrow covers, head and stroke included. */
export function arrowBounds(arrow: ArrowGeometry): Rect {
  return padRect(boundsOf([arrow.start, arrow.control, arrow.end]), ARROW_HALF_WIDTH_PX);
}

function clampInto(rect: Rect, viewport: Size): Rect {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, VIEWPORT_MARGIN_PX), Math.max(max, VIEWPORT_MARGIN_PX));
  return { ...rect, x: clamp(rect.x, viewport.width - rect.width - VIEWPORT_MARGIN_PX), y: clamp(rect.y, viewport.height - rect.height - VIEWPORT_MARGIN_PX) };
}

/** A chip just beyond `anchor` on `side`: centred beside it horizontally, start-aligned above or below. */
function chipBeside(anchor: Rect, side: Side, chip: Size, gap: number): Rect {
  const midY = anchor.y + anchor.height / 2 - chip.height / 2;
  if (side === "left") return { x: anchor.x - gap - chip.width, y: midY, ...chip };
  if (side === "right") return { x: anchor.x + anchor.width + gap, y: midY, ...chip };
  if (side === "top") return { x: anchor.x, y: anchor.y - gap - chip.height, ...chip };
  return { x: anchor.x, y: anchor.y + anchor.height + gap, ...chip };
}

type Edge = "top" | "bottom";
type Align = "end" | "start";

/**
 * A chip resting on the ring's top or bottom border, like a tab. It sits at the row's end first:
 * text (the target's own, a heading above it) usually starts at the left. Centred when the target
 * is narrower than the chip.
 */
function chipOnEdge(ring: Rect, edge: Edge, align: Align, chip: Size): Rect {
  const y = edge === "top" ? ring.y + ATTACH_OVERLAP_PX - chip.height : ring.y + ring.height - ATTACH_OVERLAP_PX;
  const roomy = chip.width + ATTACH_CORNER_INSET_PX * 2 <= ring.width;
  if (!roomy) return { x: ring.x + (ring.width - chip.width) / 2, y, ...chip };
  const x = align === "end" ? ring.x + ring.width - ATTACH_CORNER_INSET_PX - chip.width : ring.x + ATTACH_CORNER_INSET_PX;
  return { x, y, ...chip };
}

const ATTACHED: [Edge, Align][] = [
  ["top", "end"],
  ["top", "start"],
  ["bottom", "end"],
  ["bottom", "start"],
];

export interface LabelRequest {
  target: Rect;
  chip: Size;
  viewport: Size;
  /** What the chip shouldn't cover: other primitives' footprints and text near the target. */
  avoid: Rect[];
  /** What the chip must never sit under, even when nothing else fits (the notch). */
  keepOut?: Rect[];
  /** The arrow pointing at this target, if one is drawn. */
  arrow?: ArrowGeometry;
}

/** On the box's top edge, then its bottom edge, then beside it (opposite the arrow first). */
function labelCandidates({ target, chip, viewport, arrow }: LabelRequest): Rect[] {
  const ring = padRect(target, TARGET_CLEARANCE_PX);
  const attached = ATTACHED.map(([edge, align]) => chipOnEdge(ring, edge, align, chip));
  const sides = sidesByRoom(target, viewport);
  const ordered = arrow ? [OPPOSITE[arrow.side], ...sides.filter((s) => s !== OPPOSITE[arrow.side])] : sides;
  const beside = ordered.map((side) => chipBeside(ring, side, chip, LABEL_GAP_PX));
  return [...attached, ...beside].map((r) => clampInto(r, viewport));
}

/** Area of `rect` that `zones` cover (overlaps between zones counted twice: it's only a ranking). */
function coveredArea(rect: Rect, zones: Rect[]): number {
  return zones.reduce((sum, zone) => {
    const width = Math.min(rect.x + rect.width, zone.x + zone.width) - Math.max(rect.x, zone.x);
    const height = Math.min(rect.y + rect.height, zone.y + zone.height) - Math.max(rect.y, zone.y);
    return sum + Math.max(width, 0) * Math.max(height, 0);
  }, 0);
}

/**
 * Top-left corner for a target's label chip: attached to the highlight's border where that covers
 * no nearby text, else beside it; always on-screen, off the target, and never under `keepOut`.
 * When every spot covers something, the one covering least wins.
 */
export function labelPosition(request: LabelRequest): Point {
  const hard = [request.target, ...(request.keepOut ?? [])];
  const soft = [...request.avoid, ...(request.arrow ? [arrowBounds(request.arrow)] : [])];
  const candidates = labelCandidates(request);
  const allowed = candidates.filter((r) => !hard.some((zone) => intersects(r, zone)));
  const pool = allowed.length > 0 ? allowed : candidates;
  // Stable sort: equally good spots keep the preferred order (top edge first).
  const { x, y } = [...pool].sort((a, b) => coveredArea(a, soft) - coveredArea(b, soft))[0];
  return { x, y };
}

/** The numbered disc on a highlight that's one of several lit at once. */
export const BADGE_RADIUS_PX = 10;
/** Up and left of the ring's corner by this much, the disc just clears the ring's rounded corner. */
const BADGE_CORNER_OFFSET_PX = 5;

/**
 * Centre of a highlight's numbered disc: just outside the ring's top-left corner, kept whole on screen
 * (over the ring's corner when the control sits at the screen's edge).
 */
export function badgeCenter(ring: Rect, viewport: Size): Point {
  const near = BADGE_RADIUS_PX + VIEWPORT_MARGIN_PX;
  const clamp = (v: number, extent: number) => Math.min(Math.max(v, near), Math.max(extent - near, near));
  return { x: clamp(ring.x - BADGE_CORNER_OFFSET_PX, viewport.width), y: clamp(ring.y - BADGE_CORNER_OFFSET_PX, viewport.height) };
}

/** What a numbered disc covers, so a label can keep clear of it. */
export function badgeBounds(ring: Rect, viewport: Size): Rect {
  const { x, y } = badgeCenter(ring, viewport);
  return { x: x - BADGE_RADIUS_PX, y: y - BADGE_RADIUS_PX, width: BADGE_RADIUS_PX * 2, height: BADGE_RADIUS_PX * 2 };
}

/** Per-axis scale that grows `ring` by the same `spread` on every side, so a pulse stays concentric. */
export function pulseScale(ring: Rect, spread: number): Point {
  if (ring.width <= 0 || ring.height <= 0) throw new Error("A pulse needs a ring with a positive size");
  return { x: (ring.width + spread * 2) / ring.width, y: (ring.height + spread * 2) / ring.height };
}
