import type { ScreenObservation, StateSignal, UiElement } from "../../lib/types";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/…/g, "...");
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive name match; `*` in the pattern matches any run of characters. */
export function nameMatches(pattern: string, name: string): boolean {
  const p = normalize(pattern);
  const n = normalize(name);
  if (!p.includes("*")) return p === n;
  return new RegExp(`^${p.split("*").map(escapeRegex).join(".*")}$`).test(n);
}

export function findByNames(elements: UiElement[], names: string[]): UiElement[] {
  return elements.filter((e) => names.some((n) => nameMatches(n, e.name)));
}

export function evaluateSignal(signal: StateSignal, observation: ScreenObservation): boolean {
  switch (signal.kind) {
    case "element_visible":
      return findByNames(observation.elements, signal.names).length > 0;
    case "element_absent":
      return findByNames(observation.elements, signal.names).length === 0;
    case "element_selected":
      return findByNames(observation.elements, signal.names).some((e) => e.selected === true);
    case "window_title_contains":
      return normalize(observation.windowTitle).includes(normalize(signal.text));
    case "screen_tone":
      return observation.tone === signal.tone && (!signal.names || findByNames(observation.elements, signal.names).length > 0);
  }
}

/** True only on the transition into the signal's state, so a pre-existing state isn't blamed on the learner. */
export function becameTrue(signal: StateSignal, previous: ScreenObservation | undefined, next: ScreenObservation): boolean {
  return evaluateSignal(signal, next) && !(previous !== undefined && evaluateSignal(signal, previous));
}
