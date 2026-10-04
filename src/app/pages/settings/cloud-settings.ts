import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, DEFAULT_GEMINI_MODEL, DEFAULT_SENSITIVE_APPS, MAX_SENSITIVE_APP, MAX_SENSITIVE_APPS, type CloudProvider, type CloudSettings, type MemoryMode } from "../../../data/settings";
import type { ElevenLabsModel, ElevenLabsVoice, GeminiModel } from "../../../providers/cloud/catalog";
import type { KeyPresence } from "../../../providers/cloud/keys";

/** Matches MAX_KEY_CHARS in src-tauri/src/cloud/keys.rs. */
export const MAX_KEY_CHARS = 512;

export interface CloudRow {
  provider: CloudProvider;
  name: string;
  role: string;
  /** What leaves the PC when this provider is on. */
  detail: string;
  /** The provider's own page for creating an API key. */
  keyUrl: string;
  /** Where the key is on that page, when it isn't the first thing shown. */
  keyHint?: string;
}

export const CLOUD_ROWS: CloudRow[] = [
  { provider: "gemini", name: "Gemini", role: "Reasoning", detail: "Gets the goal, the current step and the names of controls on screen. No screenshots.", keyUrl: "https://aistudio.google.com/app/apikey" },
  { provider: "elevenlabs", name: "ElevenLabs", role: "Voice", detail: "Gets only the words Hodey says, to speak them in a natural voice.", keyUrl: "https://elevenlabs.io/app/settings/api-keys" },
  { provider: "backboard", name: "Backboard", role: "Memory", detail: "Gets a short summary of what you practised after each Hode, to pick up where you left off.", keyUrl: "https://app.backboard.io", keyHint: "then Settings → API Keys" },
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

/** One choice in a model or voice picker. */
export interface PickerOption {
  value: string;
  label: string;
}

export const RECOMMENDED_SUFFIX = " (recommended)";

/** Names for the defaults, shown before (or without) a list from the provider. */
const KNOWN_LABELS: Record<string, string> = {
  [DEFAULT_GEMINI_MODEL]: "Gemini 3.8 Flash",
  [DEFAULT_ELEVENLABS_MODEL]: "Eleven Flash v2.5",
  [DEFAULT_ELEVENLABS_VOICE]: "Sarah",
};

/** The listed choices, plus the current one when the list lacks it (or failed), with the default marked. */
export function pickerOptions(listed: PickerOption[], current: string, recommended: string): PickerOption[] {
  const known = listed.some((option) => option.value === current);
  const all = known ? listed : [{ value: current, label: KNOWN_LABELS[current] ?? current }, ...listed];
  return all.map((option) => (option.value === recommended ? { ...option, label: `${option.label}${RECOMMENDED_SUFFIX}` } : option));
}

export function geminiOption(model: GeminiModel): PickerOption {
  return { value: model.id, label: model.displayName || model.id };
}

export function elevenLabsModelOption(model: ElevenLabsModel): PickerOption {
  const name = model.name || model.id;
  return { value: model.id, label: model.multilingual ? name : `${name} · English only` };
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** "Sarah · American, female". */
export function voiceOption(voice: ElevenLabsVoice): PickerOption {
  const traits = [voice.labels.accent, voice.labels.gender].filter((trait): trait is string => Boolean(trait));
  const name = voice.name || voice.id;
  return { value: voice.id, label: traits.length > 0 ? `${name} · ${capitalize(traits.join(", ").toLowerCase())}` : name };
}

/** A list from the provider: not asked for yet (no key), on its way, here, or failed. */
export type CatalogState<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; items: T[] } | { status: "error"; error: string };

/** Rust's errors are readable sentences and never contain the key. */
export function catalogErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The line under a picker, or undefined when the list is loaded and has something in it. */
export function catalogStatus(state: CatalogState<unknown>, noun: "models" | "voices"): string | undefined {
  if (state.status === "idle") return `Save a key to choose from every ${noun.slice(0, -1)} on your account.`;
  if (state.status === "loading") return `Loading ${noun}…`;
  if (state.status === "error") return `Couldn't load the ${noun}: ${state.error}`;
  return state.items.length === 0 ? `No ${noun} found for this key. Hodey keeps using the one shown.` : undefined;
}

/** A link's text without the scheme: "aistudio.google.com/app/apikey". */
export function linkLabel(url: string): string {
  return url.replace(/^https:\/\//, "");
}
