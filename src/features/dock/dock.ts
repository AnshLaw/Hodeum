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
  /** While hidden: how it was shown before, so showing again restores auto-hide instead of pinning. */
  shownAs?: ShownVisibility;
}

type ShownVisibility = Exclude<Visibility, "hidden">;
const SHOWN: ShownVisibility[] = ["pinned", "auto"];

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
  const prefs: DockPrefs = {
    dock: DOCKS.includes(saved.dock as Dock) ? (saved.dock as Dock) : DEFAULT_PREFS.dock,
    visibility: VISIBILITIES.includes(saved.visibility as Visibility) ? (saved.visibility as Visibility) : DEFAULT_PREFS.visibility,
    sidebar: SIDEBAR_STYLES.includes(saved.sidebar as SidebarStyle) ? (saved.sidebar as SidebarStyle) : DEFAULT_PREFS.sidebar,
  };
  return SHOWN.includes(saved.shownAs as ShownVisibility) ? { ...prefs, shownAs: saved.shownAs as ShownVisibility } : prefs;
}

export function savePrefs(storage: WriteStorage, prefs: DockPrefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error("Couldn't save dock preferences", error);
  }
}

/** Commands from the tray menu and the Hodey key + H. Must match ids in src-tauri/src/tray.rs. */
export type ShellCommand = "show" | "toggle-visibility" | "dock-top" | "dock-left" | "dock-right" | "pinned" | "auto" | "sidebar-copilot" | "sidebar-floating";

/** Out of Hide, back to the way it was shown before (auto-hide unless it was pinned). */
function shown({ shownAs, ...prefs }: DockPrefs): DockPrefs {
  return { ...prefs, visibility: shownAs ?? DEFAULT_PREFS.visibility };
}

function hidden(prefs: DockPrefs): DockPrefs {
  return { ...prefs, visibility: "hidden", shownAs: prefs.visibility === "hidden" ? prefs.shownAs : prefs.visibility };
}

/**
 * Hide remembers how the notch was shown, and showing again restores it: pinning on Show used to switch
 * auto-hide off for good. `show` (a left-click on the tray icon) only brings back a hidden notch.
 */
export function applyCommand(prefs: DockPrefs, command: string): DockPrefs {
  switch (command as ShellCommand) {
    case "show":
      return prefs.visibility === "hidden" ? shown(prefs) : prefs;
    case "toggle-visibility":
      return prefs.visibility === "hidden" ? shown(prefs) : hidden(prefs);
    case "dock-top":
      return { ...prefs, dock: "top" };
    case "dock-left":
      return { ...prefs, dock: "left" };
    case "dock-right":
      return { ...prefs, dock: "right" };
    case "pinned":
    case "auto": {
      const { shownAs: _forgotten, ...rest } = prefs;
      return { ...rest, visibility: command as Visibility };
    }
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

/** What Hodey is doing with the learner: the Hode's phase, and the spoken exchange, which can run with no Hode at all. */
export interface Engagement {
  phase: HodePhase;
  /** The mic is open for the learner: a tap or held key, after the wake word, or a conversation's open mic. */
  listening: boolean;
  /** Hodey is saying something. */
  speaking: boolean;
  /** A conversation is open: the mic stays, or reopens, for the learner's reply between turns. */
  conversing: boolean;
}

/**
 * Hodey is busy with the learner: listening, thinking, answering, speaking or guiding, or a Hode or a conversation
 * is under way. A greeting, an app opened by voice and a conversation's follow-up all happen while the phase is idle.
 * A paused Hode isn't: it rests like a sleeping Hodey.
 */
export function engaged(e: Engagement): boolean {
  return e.listening || e.speaking || e.conversing || (hodeActive(e.phase) && e.phase !== "paused");
}

/** Auto-hide shows the whole notch while the learner reaches for it or Hodey is engaged; otherwise it rests as the orb. */
export function shouldReveal(visibility: Visibility, hovered: boolean, engagement: Engagement): boolean {
  switch (visibility) {
    case "pinned":
      return true;
    case "hidden":
      return false;
    case "auto":
      return hovered || engaged(engagement);
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
