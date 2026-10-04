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
/** The highlight ring's outset: labels keep clear of the ring, not just the element. */
const TARGET_CLEARANCE_PX = 4;
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
 * centre. Undefined when the target is off-screen or no side has room for an on-screen arrow.
 */
export function arrowGeometry(target: Rect, viewport: Size, avoid: Rect[] = []): ArrowGeometry | undefined {
  const visible = visiblePart(target, viewport);
  if (!visible) return undefined;
  const fitting = sidesByRoom(visible, viewport).flatMap((side) => arrowFrom(visible, side, viewport) ?? []);
  const clear = fitting.find((arrow) => !avoid.some((zone) => intersects(arrowBounds(arrow), zone)));
  return clear ?? fitting[0];
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

/** Beyond the arrow's tail, in the open space the arrow came from. */
function chipAtTail(arrow: ArrowGeometry, chip: Size): Rect {
  const tail = { x: arrow.start.x, y: arrow.start.y, width: 0, height: 0 };
  const beside = chipBeside(tail, arrow.side, chip, LABEL_GAP_PX + ARROW_HALF_WIDTH_PX);
  const vertical = arrow.side === "top" || arrow.side === "bottom";
  return vertical ? { ...beside, x: arrow.start.x - chip.width / 2 } : beside;
}

export interface LabelRequest {
  target: Rect;
  chip: Size;
  viewport: Size;
  /** Other primitives' footprints the chip must not cover. */
  avoid: Rect[];
  /** The arrow pointing at this target, if one is drawn. */
  arrow?: ArrowGeometry;
}

function labelCandidates({ target, chip, viewport, arrow }: LabelRequest): Rect[] {
  const ring = padRect(target, TARGET_CLEARANCE_PX);
  const sides = sidesByRoom(target, viewport);
  const ordered = arrow ? [OPPOSITE[arrow.side], ...sides.filter((s) => s !== OPPOSITE[arrow.side])] : sides;
  const beside = ordered.map((side) => chipBeside(ring, side, chip, LABEL_GAP_PX));
  const candidates = arrow ? [beside[0], chipAtTail(arrow, chip), ...beside.slice(1)] : beside;
  return candidates.map((r) => clampInto(r, viewport));
}

/**
 * Top-left corner for a target's label chip: opposite the arrow, else at the arrow's tail, else
 * beside the target on its roomiest side; always on-screen and clear of the target and other marks.
 */
export function labelPosition(request: LabelRequest): Point {
  const blocked = [padRect(request.target, TARGET_CLEARANCE_PX), ...request.avoid, ...(request.arrow ? [arrowBounds(request.arrow)] : [])];
  const candidates = labelCandidates(request);
  const clear = candidates.find((r) => !blocked.some((b) => intersects(r, b)));
  const { x, y } = clear ?? candidates[0];
  return { x, y };
}

/** Per-axis scale that grows `ring` by the same `spread` on every side, so a pulse stays concentric. */
export function pulseScale(ring: Rect, spread: number): Point {
  if (ring.width <= 0 || ring.height <= 0) throw new Error("A pulse needs a ring with a positive size");
  return { x: (ring.width + spread * 2) / ring.width, y: (ring.height + spread * 2) / ring.height };
}
