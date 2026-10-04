import type { HodePhase } from "../hode/model";

export const DOCKS = ["top", "left", "right"] as const;
export type Dock = (typeof DOCKS)[number];
export const VISIBILITIES = ["pinned", "auto", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];
/** Copilot: a real side panel that windows move aside for. Floating: hovers over windows. */
export const SIDEBAR_STYLES = ["copilot", "floating"] as const;
export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

export interface DockPrefs {
  dock: Dock;
  visibility: Visibility;
  sidebar: SidebarStyle;
}

export const DEFAULT_PREFS: DockPrefs = { dock: "top", visibility: "auto", sidebar: "copilot" };
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
    sidebar: SIDEBAR_STYLES.includes(saved.sidebar as SidebarStyle) ? (saved.sidebar as SidebarStyle) : DEFAULT_PREFS.sidebar,
  };
}

export function savePrefs(storage: WriteStorage, prefs: DockPrefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error("Couldn't save dock preferences", error);
  }
}

/** Commands from the tray menu and the Hodey key + H. Must match ids in src-tauri/src/tray.rs. */
export type ShellCommand = "toggle-visibility" | "dock-top" | "dock-left" | "dock-right" | "pinned" | "auto" | "sidebar-copilot" | "sidebar-floating";

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
    case "sidebar-copilot":
      return { ...prefs, sidebar: "copilot" };
    case "sidebar-floating":
      return { ...prefs, sidebar: "floating" };
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

/**
 * A copilot sidebar reserves its width (an app bar, with windows moved aside) while it's meant to be
 * open: always when pinned, during a Hode under auto-hide. Floating sidebars and the top notch never do.
 */
export function reservesSpace(prefs: DockPrefs, phase: HodePhase): boolean {
  if (prefs.dock === "top" || prefs.sidebar !== "copilot") return false;
  return prefs.visibility === "pinned" || (prefs.visibility === "auto" && hodeActive(phase));
}

/** The Hodeum app around the notch: on screen (the notch steps aside), folding back into it, or gone. */
export type AppPresence = "open" | "closing" | "closed";

export interface NotchWindow {
  visible: boolean;
  reserve: boolean;
}

/**
 * What the notch window should be, given the learner's prefs and the app. The prefs are never changed
 * while the app is open, so closing it restores exactly what the learner had. The notch reappears as the
 * app folds into it, but a copilot strip is reserved again only once the app is gone, so windows moved
 * aside never jump under the fold.
 */
export function notchWindow(prefs: DockPrefs, phase: HodePhase, presence: AppPresence): NotchWindow {
  return {
    visible: presence !== "open" && prefs.visibility !== "hidden",
    reserve: presence === "closed" && reservesSpace(prefs, phase),
  };
}
