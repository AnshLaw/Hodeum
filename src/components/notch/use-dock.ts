import { useCallback, useEffect, useState } from "react";
import { reportError } from "../../lib/errors";
import type { Bus } from "../../lib/bus";
import type { NativeShell } from "../../lib/shell";
import { applyCommand, loadPrefs, notchWindow, savePrefs, shouldReveal, type AppPresence, type DockPrefs, type Engagement } from "../../features/dock/dock";
import { usePulse } from "./hooks";

/**
 * Keeps auto-hide from flickering as the cursor brushes past the edge, or as Hodey's signals hand over to each
 * other (a line ending as the mic opens for the reply).
 */
const AUTO_HIDE_DELAY_MS = 2500;
/** A click on the tucked orb that comes with no hover (touch, a screen reader) holds the notch out this long. */
const ORB_CLICK_HOLD_MS = 3000;

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch (error) {
    console.error("Local storage is unavailable; dock preferences won't persist", error);
    return undefined;
  }
}

export interface DockController {
  prefs: DockPrefs;
  update(change: Partial<DockPrefs>): void;
  command(command: string): void;
}

/** Lets the app window show and change where Hodey lives. */
function useDockBroadcast(bus: Bus, prefs: DockPrefs, update: (change: Partial<DockPrefs>) => void): void {
  useEffect(() => bus.emit("dock:prefs", prefs), [bus, prefs]);
  useEffect(() => bus.on("dock:prefs-request", () => bus.emit("dock:prefs", prefs)), [bus, prefs]);
  useEffect(() => bus.on("dock:change", update), [bus, update]);
}

/** Whether the Hodeum app is on screen; the notch steps aside while it is. */
function useAppPresence(bus: Bus): AppPresence {
  const [presence, setPresence] = useState<AppPresence>("closed");
  useEffect(() => bus.on("app:presence", (state) => setPresence(state.presence)), [bus]);
  return presence;
}

/**
 * Owns dock + visibility preferences and mirrors them onto the native window (stepping aside for the app).
 * `inHode` (see `holdsSpace`) decides whether an auto-hiding copilot sidebar reserves its strip;
 * `searchingWeb` brings the notch out over the app while it searches.
 */
export function useDock(shell: NativeShell, inHode: boolean, bus: Bus, searchingWeb = false): DockController {
  const [prefs, setPrefs] = useState<DockPrefs>(() => {
    const storage = browserStorage();
    return storage ? loadPrefs(storage) : loadPrefs({ getItem: () => null });
  });
  const { visible, reserve } = notchWindow(prefs, inHode, useAppPresence(bus), searchingWeb);

  useEffect(() => {
    const storage = browserStorage();
    if (storage) savePrefs(storage, prefs);
  }, [prefs]);
  useEffect(() => {
    shell.setDock(prefs.dock, reserve).catch(reportError("Couldn't move Hodey to its dock"));
  }, [shell, prefs.dock, reserve]);
  useEffect(() => {
    shell.setNotchVisible(visible).catch(reportError("Couldn't show or hide Hodey"));
  }, [shell, visible]);

  const update = useCallback((change: Partial<DockPrefs>) => setPrefs((current) => ({ ...current, ...change })), []);
  const command = useCallback((name: string) => setPrefs((current) => applyCommand(current, name)), []);

  useEffect(() => shell.onDockSnapped((dock) => update({ dock })), [shell, update]);
  useEffect(() => shell.onShellCommand(command), [shell, command]);
  useDockBroadcast(bus, prefs, update);
  return { prefs, update, command };
}

/**
 * Auto-hide: reveal immediately, fold back into the orb only once the cursor has been gone and Hodey idle a moment.
 * The second value brings the notch out from a click on the orb.
 */
export function useRevealed(prefs: DockPrefs, hovered: boolean, engagement: Engagement): [boolean, () => void] {
  const [clicked, reveal] = usePulse(ORB_CLICK_HOLD_MS);
  const wanted = shouldReveal(prefs.visibility, hovered || clicked, engagement);
  const [revealed, setRevealed] = useState(wanted);
  useEffect(() => {
    if (wanted) {
      setRevealed(true);
      return;
    }
    const timer = setTimeout(() => setRevealed(false), AUTO_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wanted]);
  // Reveal in the same render the hover arrives in; otherwise the side panel first opens while still
  // a small orb and only grows a frame later.
  return [wanted || revealed, reveal];
}
