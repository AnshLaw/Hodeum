import { useCallback, useEffect, useState } from "react";
import { reportError } from "../../lib/errors";
import type { Bus } from "../../lib/bus";
import type { NativeShell } from "../../lib/shell";
import type { HodePhase } from "../../features/hode/model";
import { applyCommand, loadPrefs, reservesSpace, savePrefs, shouldReveal, type DockPrefs } from "../../features/dock/dock";

/** Keeps auto-hide from flickering as the cursor brushes past the edge. */
const AUTO_HIDE_DELAY_MS = 2500;

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

/** Owns dock + visibility preferences and mirrors them onto the native window. */
export function useDock(shell: NativeShell, phase: HodePhase, bus: Bus): DockController {
  const [prefs, setPrefs] = useState<DockPrefs>(() => {
    const storage = browserStorage();
    return storage ? loadPrefs(storage) : loadPrefs({ getItem: () => null });
  });
  const reserve = reservesSpace(prefs, phase);

  useEffect(() => {
    const storage = browserStorage();
    if (storage) savePrefs(storage, prefs);
  }, [prefs]);
  useEffect(() => {
    shell.setDock(prefs.dock, reserve).catch(reportError("Couldn't move Hodey to its dock"));
  }, [shell, prefs.dock, reserve]);
  useEffect(() => {
    shell.setNotchVisible(prefs.visibility !== "hidden").catch(reportError("Couldn't show or hide Hodey"));
  }, [shell, prefs.visibility]);

  const update = useCallback((change: Partial<DockPrefs>) => setPrefs((current) => ({ ...current, ...change })), []);
  const command = useCallback((name: string) => setPrefs((current) => applyCommand(current, name)), []);

  useEffect(() => shell.onDockSnapped((dock) => update({ dock })), [shell, update]);
  useEffect(() => shell.onShellCommand(command), [shell, command]);
  useDockBroadcast(bus, prefs, update);
  return { prefs, update, command };
}

/** Auto-hide: reveal immediately, tuck away only after the cursor has been gone a moment. */
export function useRevealed(prefs: DockPrefs, hovered: boolean, phase: HodePhase): boolean {
  const wanted = shouldReveal(prefs.visibility, hovered, phase);
  const [revealed, setRevealed] = useState(wanted);
  useEffect(() => {
    if (wanted) {
      setRevealed(true);
      return;
    }
    const timer = setTimeout(() => setRevealed(false), AUTO_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [wanted]);
  return revealed;
}
