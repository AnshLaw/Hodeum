import { DEFAULT_SENSITIVE_APPS, MAX_SENSITIVE_APP, MAX_SENSITIVE_APPS, type CloudProvider, type CloudSettings, type MemoryMode } from "../../../data/settings";
import type { KeyPresence } from "../../../providers/cloud/keys";

/** Matches MAX_KEY_CHARS in src-tauri/src/cloud/keys.rs. */
export const MAX_KEY_CHARS = 512;

export interface CloudRow {
  provider: CloudProvider;
  name: string;
  role: string;
  /** What leaves the PC when this provider is on. */
  detail: string;
}

export const CLOUD_ROWS: CloudRow[] = [
  { provider: "gemini", name: "Gemini", role: "Reasoning", detail: "Gets the goal, the current step and the names of controls on screen. No screenshots." },
  { provider: "elevenlabs", name: "ElevenLabs", role: "Voice", detail: "Gets only the words Hodey says, to speak them in a natural voice." },
  { provider: "backboard", name: "Backboard", role: "Memory", detail: "Gets a short summary of what you practised after each Hode, to pick up where you left off." },
];

export const MEMORY_OPTIONS: [MemoryMode, string][] = [
  ["off", "Off"],
  ["auto", "Auto"],
  ["readonly", "Read-only"],
];

export function keyStatusLabel(present: boolean): string {
  return present ? "Key saved" : "No key";
}

/** A provider can be switched on only once its key is saved; unknown presence counts as no key. */
export function controlEnabled(presence: KeyPresence | undefined, provider: CloudProvider): boolean {
  return presence?.[provider] === true;
}

/** The provider's own setting: a switch for Gemini and ElevenLabs, a memory mode for Backboard. */
export function withProvider(cloud: CloudSettings, provider: CloudProvider, value: boolean | MemoryMode): CloudSettings {
  if (provider === "gemini") return { ...cloud, reasoning: value === true };
  if (provider === "elevenlabs") return { ...cloud, voice: value === true };
  return { ...cloud, memory: typeof value === "string" ? value : "off" };
}

/** No key means off, so saving a key later never silently turns cloud back on. */
export function withKeyCleared(cloud: CloudSettings, provider: CloudProvider): CloudSettings {
  return withProvider(cloud, provider, provider === "backboard" ? "off" : false);
}

/** Why a typed key can't be saved yet, or undefined when it can. Never includes the key. */
export function keyDraftError(draft: string): string | undefined {
  const key = draft.trim();
  if (key === "") return "Paste a key first.";
  if (/\s/.test(key)) return "Keys don't contain spaces.";
  if (key.length > MAX_KEY_CHARS) return "That's too long to be a key.";
  return undefined;
}

/** A recoverable inline message for a failed save or clear. Rust's errors never contain the key. */
export function keyErrorMessage(error: unknown, action: "save" | "clear"): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Couldn't ${action === "save" ? "save" : "remove"} the key: ${reason}`;
}

export type SensitiveAppEdit = { apps: string[] } | { error: string };

export function addSensitiveApp(apps: string[], draft: string): SensitiveAppEdit {
  const name = draft.trim();
  if (name === "") return { error: "Type an app or site name." };
  if (name.length > MAX_SENSITIVE_APP) return { error: `Keep it under ${MAX_SENSITIVE_APP + 1} characters.` };
  const existing = apps.find((app) => app.toLowerCase() === name.toLowerCase());
  if (existing) return { error: `${existing} is already on the list.` };
  if (apps.length >= MAX_SENSITIVE_APPS) return { error: "The list is full. Remove one first." };
  return { apps: [...apps, name] };
}

export function removeSensitiveApp(apps: string[], app: string): string[] {
  return apps.filter((existing) => existing !== app);
}

export function resetSensitiveApps(): string[] {
  return [...DEFAULT_SENSITIVE_APPS];
}

export function isDefaultSensitiveApps(apps: string[]): boolean {
  return apps.length === DEFAULT_SENSITIVE_APPS.length && apps.every((app, i) => app === DEFAULT_SENSITIVE_APPS[i]);
}
