import type { Rect, Size } from "../../lib/types";
import { IPHONE_ASPECT } from "../../features/phone/frame-math";

/** CSS px around the mirrored screen; keep in sync with `.phone-panel` in notch.css. */
export const PHONE_LAYOUT = {
  /** The notch bar above the panel. */
  barHeight: 38,
  padTop: 4,
  padBottom: 12,
  padX: 12,
  /** Between the phone and the guidance column. */
  gap: 12,
  /** Hodey's guidance beside the phone in the top notch. */
  sideColumn: 300,
  /** Kept free under the notch: the taskbar edge, a toast or the "heard" line. */
  bottomMargin: 48,
  /** Big enough to read the phone; bigger only costs screen. */
  maxScreenHeight: 860,
  /** The sidebar is at most 360 px wide; the phone sits centred with a margin. */
  stackedMaxWidth: 300,
  /** Sidebar bar, source picker and a guidance card below the phone. */
  stackedReserve: 320,
} as const;

export type PhoneArrangement = "beside" | "stacked";

const EMPTY: Rect = { x: 0, y: 0, width: 0, height: 0 };

const usable = (size: Size | undefined): size is Size => size !== undefined && size.width > 0 && size.height > 0 && Number.isFinite(size.width / size.height);

/** Width ÷ height of the incoming (cropped) frames; an iPhone's 9 : 19.5 until one arrives. */
export function frameAspect(frame: Size | undefined): number {
  return usable(frame) ? frame.width / frame.height : IPHONE_ASPECT;
}

/** The panel's chrome beside the phone, in the top notch. */
const BESIDE_CHROME_WIDTH = 2 * PHONE_LAYOUT.padX + PHONE_LAYOUT.gap + PHONE_LAYOUT.sideColumn;
const BESIDE_CHROME_HEIGHT = PHONE_LAYOUT.barHeight + PHONE_LAYOUT.padTop + PHONE_LAYOUT.padBottom;

/** The largest screen box that fits `room`, keeping the frame's aspect, never cropped. */
export function phoneScreenSize(room: Size, aspect: number, arrangement: PhoneArrangement): Size {
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : IPHONE_ASPECT;
  const beside = arrangement === "beside";
  const roomHeight = beside ? room.height - PHONE_LAYOUT.bottomMargin - BESIDE_CHROME_HEIGHT : room.height - PHONE_LAYOUT.stackedReserve;
  const roomWidth = beside ? room.width - BESIDE_CHROME_WIDTH : Math.min(room.width, PHONE_LAYOUT.stackedMaxWidth);
  const height = Math.max(0, Math.min(roomHeight, PHONE_LAYOUT.maxScreenHeight, roomWidth / ratio));
  return { width: Math.round(height * ratio), height: Math.round(height) };
}

/** The top notch's width while it holds the phone beside the guidance. */
export function phoneNotchWidth(screen: Size): number {
  return screen.width + BESIDE_CHROME_WIDTH;
}

/** The top notch's height while it holds the phone (the guidance column is shorter). */
export function phoneNotchHeight(screen: Size): number {
  return screen.height + BESIDE_CHROME_HEIGHT;
}

/** The part of `box` (viewport CSS px) that is on screen: the notch window, or the stage above the fold. */
export function visibleRoom(box: Rect, viewport: Size): Size {
  const top = Math.max(box.y, 0);
  const bottom = Math.min(box.y + box.height, viewport.height);
  const left = Math.max(box.x, 0);
  const right = Math.min(box.x + box.width, viewport.width);
  return { width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** A highlight in frame pixels, placed on the screen as displayed (the canvas fills it exactly). */
export function markRect(bounds: Rect, frame: Size, display: Size): Rect {
  if (!usable(frame)) return EMPTY;
  const sx = display.width / frame.width;
  const sy = display.height / frame.height;
  return { x: bounds.x * sx, y: bounds.y * sy, width: bounds.width * sx, height: bounds.height * sy };
}
