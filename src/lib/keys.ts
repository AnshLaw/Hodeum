/**
 * One "Hodey key" (Right Ctrl by default): hold it to talk, or press it with one letter. Must match
 * src-tauri/src/hodey_key.rs, which handles the keys system-wide.
 */
export const HODEY_KEYS = ["right-ctrl", "right-alt"] as const;
export type HodeyKey = (typeof HODEY_KEYS)[number];

export const HODEY_KEY_LABELS: Record<HodeyKey, string> = { "right-ctrl": "Right Ctrl", "right-alt": "Right Alt" };

export type KeyCommand = "point" | "show-hide" | "open-app";

/** Letter → command, with the Hodey key held. */
export const KEY_LETTERS: Record<KeyCommand, string> = { point: "P", "show-hide": "H", "open-app": "A" };

const COMMAND_LABELS: Record<KeyCommand, string> = { point: "Point & Ask", "show-hide": "Show or hide Hodey", "open-app": "Open the Hodeum app" };

export interface Shortcut {
  keys: string[];
  does: string;
}

export function shortcutsFor(key: HodeyKey): Shortcut[] {
  const label = HODEY_KEY_LABELS[key];
  const commands = (Object.keys(KEY_LETTERS) as KeyCommand[]).map((command) => ({ keys: [label, KEY_LETTERS[command]], does: COMMAND_LABELS[command] }));
  return [{ keys: [label], does: "Hold to talk to Hodey, let go to send" }, ...commands];
}

const DOM_CODES: Record<HodeyKey, string> = { "right-ctrl": "ControlRight", "right-alt": "AltRight" };

/** The browser practice stage's version of the system-wide keys (no voice there, so no hold-to-talk). */
export class StageKeys {
  private held = false;

  constructor(private readonly key: () => HodeyKey) {}

  handle(event: { type: string; code: string }): KeyCommand | undefined {
    if (event.code === DOM_CODES[this.key()]) {
      this.held = event.type === "keydown";
      return undefined;
    }
    if (event.type !== "keydown" || !this.held) return undefined;
    const letter = event.code.replace(/^Key/, "");
    return (Object.keys(KEY_LETTERS) as KeyCommand[]).find((command) => KEY_LETTERS[command] === letter);
  }
}

let current: HodeyKey = "right-ctrl";
const listeners = new Set<(key: HodeyKey) => void>();

/** The Hodey key this window last heard from settings, for hints like "Right Ctrl + H brings it back". */
export const hodeyKeySetting = {
  get: (): HodeyKey => current,
  set(key: HodeyKey): void {
    current = key;
    listeners.forEach((listener) => listener(key));
  },
  subscribe(listener: (key: HodeyKey) => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
