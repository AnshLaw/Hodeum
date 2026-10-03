import type { HodePhase } from "../hode/model";

export const DOCKS = ["top", "left", "right"] as const;
export type Dock = (typeof DOCKS)[number];
export const VISIBILITIES = ["pinned", "auto", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface DockPrefs {
  dock: Dock;
  visibility: Visibility;
}

export const DEFAULT_PREFS: DockPrefs = { dock: "top", visibility: "auto" };
const PREFS_KEY = "hodeum.dock";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

/** Reads saved preferences, falling back field by field to defaults for anything missing or invalid. */
export function loadPrefs(storage: ReadStorage): DockPrefs {
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(PREFS_KEY) ?? "null");
  } catch (error) {
    console.error("Ignoring unreadable dock preferences", error);
    return DEFAULT_PREFS;
  }
  const saved = (raw ?? {}) as Partial<Record<keyof DockPrefs, unknown>>;
  return {
    dock: DOCKS.includes(saved.dock as Dock) ? (saved.dock as Dock) : DEFAULT_PREFS.dock,
    visibility: VISIBILITIES.includes(saved.visibility as Visibility) ? (saved.visibility as Visibility) : DEFAULT_PREFS.visibility,
  };
}

export function savePrefs(storage: WriteStorage, prefs: DockPrefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error("Couldn't save dock preferences", error);
  }
}

/** Commands from the tray menu and Ctrl+Alt+N. Must match ids in src-tauri/src/tray.rs. */
export type ShellCommand = "toggle-visibility" | "dock-top" | "dock-left" | "dock-right" | "pinned" | "auto";

/** Showing again after Hide pins the notch, so it doesn't immediately tuck away under auto-hide. */
export function applyCommand(prefs: DockPrefs, command: string): DockPrefs {
  switch (command as ShellCommand) {
    case "toggle-visibility":
      return { ...prefs, visibility: prefs.visibility === "hidden" ? "pinned" : "hidden" };
    case "dock-top":
      return { ...prefs, dock: "top" };
    case "dock-left":
      return { ...prefs, dock: "left" };
    case "dock-right":
      return { ...prefs, dock: "right" };
    case "pinned":
    case "auto":
      return { ...prefs, visibility: command as Visibility };
    default:
      console.error(`Unknown shell command: ${command}`);
      return prefs;
  }
}

/** A Hode in progress always needs the notch visible (unless the learner hid it outright). */
export function hodeActive(phase: HodePhase): boolean {
  return phase !== "idle";
}

export function shouldReveal(visibility: Visibility, hovered: boolean, phase: HodePhase): boolean {
  switch (visibility) {
    case "pinned":
      return true;
    case "hidden":
      return false;
    case "auto":
      return hovered || hodeActive(phase);
  }
}

/** Side docks reserve screen space (an app bar) only while a Hode is active, so idle Hodey costs no width. */
export function reservesSpace(dock: Dock, phase: HodePhase, visibility: Visibility): boolean {
  return dock !== "top" && visibility !== "hidden" && hodeActive(phase);
}
