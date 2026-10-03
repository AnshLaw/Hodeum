import type { Rect, UiElement } from "../../lib/types";

export const DESKTOP = { width: 1280, height: 900 } as const;
/** Starts below the expanded notch card, which sits flush with the top edge. */
export const APP_WINDOW: Rect = { x: 40, y: 220, width: 1200, height: 660 };
export const TITLE_BAR_HEIGHT = 32;
const MOCK_CONFIDENCE = 0.95;

export function element(id: string, name: string, role: string, bounds: Rect, selected?: boolean): UiElement {
  return { id, name, role, bounds, source: "mock", confidence: MOCK_CONFIDENCE, ...(selected === undefined ? {} : { selected }) };
}

/** "tab:Insert" -> ["tab", "Insert"] */
export function splitId(id: string): [string, string] {
  const index = id.indexOf(":");
  return index < 0 ? [id, ""] : [id.slice(0, index), id.slice(index + 1)];
}

export function toggle(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}
