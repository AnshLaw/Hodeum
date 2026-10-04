import type { StateSignal } from "../../lib/types";
import { currentStep, type HodeState } from "./model";

/** At most this many names per read; the native side (`MAX_WANTED` in src-tauri/src/perception/wanted.rs) takes no more. */
export const MAX_WANTED_NAMES = 8;
/** A name with this is a pattern ("Display is *"): it can't be searched for by name, only matched in a read. */
const WILDCARD = "*";

/** The controls a signal waits on, when it names them. */
function signalNames(signal: StateSignal): string[] {
  switch (signal.kind) {
    case "element_visible":
    case "element_absent":
    case "element_selected":
    case "element_checked":
      return signal.names;
    case "window_title_contains":
    case "screen_tone":
      return [];
  }
}

/**
 * The controls a screen read must not miss for the current lesson step, even when its walk runs out of
 * time (a dialog that just opened answers slowly): the step's target, then the controls its success
 * signal names. Nothing outside a lesson's steps.
 */
export function wantedNames(state: HodeState): string[] {
  const step = currentStep(state);
  if (!step) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const name of [...step.target.names, ...signalNames(step.success)].map((raw) => raw.trim())) {
    // The same name as signals.ts compares names: in any case, "…" as "...".
    const key = name.toLowerCase().replace(/…/g, "...");
    if (name === "" || name.includes(WILDCARD) || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.slice(0, MAX_WANTED_NAMES);
}
