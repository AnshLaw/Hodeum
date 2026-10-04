import { z } from "zod";
import { HODEY_KEYS } from "../lib/keys";
import { HODE_MODES } from "../lib/types";

const MIN_RATE = 0.6;
const MAX_RATE = 1.6;
const MIN_STUCK_SECONDS = 5;
const MAX_STUCK_SECONDS = 60;

export const THEMES = ["system", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];
export const ACCENTS = ["amber", "mint", "sky", "rose", "violet"] as const;
export type Accent = (typeof ACCENTS)[number];
export const HODEY_COLORS = ["amber", "mint", "sky", "coral", "violet", "snow"] as const;
export type HodeyColor = (typeof HODEY_COLORS)[number];
export const HODEY_ACCESSORIES = ["none", "glasses", "headphones", "beanie"] as const;
export type HodeyAccessory = (typeof HODEY_ACCESSORIES)[number];
/** Must match ASR_LANGUAGES in src-tauri/src/voice/listen.rs. */
export const SPEECH_LANGUAGES = ["en", "en-GB", "hi", "auto"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
export const MAX_WAKE_WORDS = 8;
export const MAX_WAKE_WORD = 30;
/** Longest voice id kept; Windows voice URIs are well under this. */
const MAX_VOICE_NAME = 200;

export const DEFAULT_APPEARANCE = { theme: "dark", accent: "amber", hodeyColor: "amber", hodeyAccessory: "none" } as const;

const appearanceSchema = z
  .object({
    theme: z.enum(THEMES).catch(DEFAULT_APPEARANCE.theme),
    accent: z.enum(ACCENTS).catch(DEFAULT_APPEARANCE.accent),
    hodeyColor: z.enum(HODEY_COLORS).catch(DEFAULT_APPEARANCE.hodeyColor),
    hodeyAccessory: z.enum(HODEY_ACCESSORIES).catch(DEFAULT_APPEARANCE.hodeyAccessory),
  })
  .default(DEFAULT_APPEARANCE);

export const settingsSchema = z.object({
  voice: z.object({
    enabled: z.boolean(),
    rate: z.number().min(MIN_RATE).max(MAX_RATE),
    /** A natural voice ("hodey:kokoro:3") or a Windows voice URI; empty means Hodey's default. */
    name: z.string().max(MAX_VOICE_NAME).default(""),
    /** Talk back and forth: after Hodey answers, the mic reopens briefly for the learner's reply. */
    conversation: z.boolean().default(true),
    /** Hands-free: the mic stays on, waiting for a wake word (opt-in; off by default). */
    handsFree: z.boolean().default(false),
    /** What the learner speaks: Nemotron's language prompt (no en-IN exists; en-GB can suit Indian English). */
    language: z.enum(SPEECH_LANGUAGES).catch("en").default("en"),
    /** Extra names for Hodey ("Hey Hodes"), recognised like "Hey Hodey". */
    wakeWords: z.array(z.string().trim().min(1).max(MAX_WAKE_WORD)).max(MAX_WAKE_WORDS).default([]),
  }),
  /** How new Hodes run by default; each Hode can still pick its own. */
  mode: z.enum(HODE_MODES).catch("teach").default("teach"),
  /** How long Hodey waits without progress before offering more help. */
  stuckSeconds: z.number().int().min(MIN_STUCK_SECONDS).max(MAX_STUCK_SECONDS),
  appearance: appearanceSchema,
  /** Off by default: when on, only a scrubbed, generic query leaves the PC. */
  webSearch: z.boolean().default(false),
  /** Hold to talk; with a letter for commands. */
  hodeyKey: z.enum(HODEY_KEYS).catch("right-ctrl").default("right-ctrl"),
});

export type Settings = z.infer<typeof settingsSchema>;
export type Appearance = Settings["appearance"];

export const DEFAULT_SETTINGS: Settings = {
  voice: { enabled: true, rate: 1.05, name: "", conversation: true, handsFree: false, language: "en", wakeWords: [] },
  mode: "teach",
  stuckSeconds: 12,
  appearance: { ...DEFAULT_APPEARANCE },
  webSearch: false,
  hodeyKey: "right-ctrl",
};

export const SETTINGS_LIMITS = { MIN_RATE, MAX_RATE, MIN_STUCK_SECONDS, MAX_STUCK_SECONDS } as const;

/** Saved settings, field by field: anything missing or invalid falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const result = settingsSchema.shape[key].safeParse(value[key]);
    return (result.success ? result.data : DEFAULT_SETTINGS[key]) as Settings[K];
  };
  return { voice: pick("voice"), mode: pick("mode"), stuckSeconds: pick("stuckSeconds"), appearance: pick("appearance"), webSearch: pick("webSearch"), hodeyKey: pick("hodeyKey") };
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

export class MemorySettingsStore implements SettingsStore {
  private settings: Settings = DEFAULT_SETTINGS;

  async load(): Promise<Settings> {
    return this.settings;
  }

  async save(settings: Settings): Promise<void> {
    this.settings = settingsSchema.parse(settings);
  }
}
