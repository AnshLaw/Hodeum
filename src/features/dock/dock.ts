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

/** Starting preferences for a surface with a different default (the practice stage); a saved choice always wins. */
export function seedPrefs(storage: ReadStorage & WriteStorage, prefs: DockPrefs): void {
  if (storage.getItem(PREFS_KEY) === null) savePrefs(storage, prefs);
}

/** Commands from the tray menu and the Hodey key + H. Must match ids in src-tauri/src/tray.rs. */
export type ShellCommand = "show" | "toggle-visibility" | "dock-top" | "dock-left" | "dock-right" | "pinned" | "auto" | "sidebar-copilot" | "sidebar-floating";

/**
 * Showing again after Hide pins the notch, so it doesn't immediately tuck away under auto-hide.
 * `show` (a left-click on the tray icon) only brings back a hidden notch; it never hides one.
 */
export function applyCommand(prefs: DockPrefs, command: string): DockPrefs {
  switch (command as ShellCommand) {
    case "show":
      return prefs.visibility === "hidden" ? { ...prefs, visibility: "pinned" } : prefs;
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

/** The parts of the Hode state that say whether a Hode (not just a question) is under way. */
export interface HodeProgress {
  phase: HodePhase;
  pack?: object;
  open: boolean;
  resumePhase?: HodePhase;
}

/**
 * Whether a Hode is under way, from the goal form to the success card. A one-off Point & Ask or
 * spoken question from idle is not one: reserving for it would shove the learner's windows aside the
 * moment they start marking, then back again once the answer is dismissed.
 */
export function holdsSpace(s: HodeProgress): boolean {
  if (s.phase === "idle") return false;
  return s.phase === "goal_entry" || s.resumePhase === "goal_entry" || s.pack !== undefined || s.open;
}

/**
 * A copilot sidebar reserves its width (an app bar, with windows moved aside) while it's meant to be
 * open: always when pinned, during a Hode under auto-hide. Floating sidebars and the top notch never do.
 */
export function reservesSpace(prefs: DockPrefs, inHode: boolean): boolean {
  if (prefs.dock === "top" || prefs.sidebar !== "copilot") return false;
  return prefs.visibility === "pinned" || (prefs.visibility === "auto" && inHode);
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
 * aside never jump under the fold. While the app searches the web the notch comes out over it, so the
 * learner sees exactly what leaves the PC.
 */
export function notchWindow(prefs: DockPrefs, inHode: boolean, presence: AppPresence, searchingWeb = false): NotchWindow {
  return {
    visible: (presence !== "open" || searchingWeb) && prefs.visibility !== "hidden",
    reserve: presence === "closed" && reservesSpace(prefs, inHode),
  };
}
