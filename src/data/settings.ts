import { z } from "zod";
import { HODEY_KEYS } from "../lib/keys";
import { AGENT_STYLES, HODE_MODES } from "../lib/types";

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
/** "auto": Hodey follows whichever of English, Hindi or Hinglish the learner speaks. */
export const SPEECH_LANGUAGES = ["auto", "en", "en-GB", "hi", "hinglish"] as const;
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];
export const HINDI_SCRIPTS = ["devanagari", "roman"] as const;
export type HindiScript = (typeof HINDI_SCRIPTS)[number];
/** Kokoro's "Alpha" (Hindi, female). */
export const DEFAULT_HINDI_VOICE = "kokoro:31";
export const MAX_WAKE_WORDS = 8;
export const MAX_WAKE_WORD = 30;
/** Longest voice id kept; Windows voice URIs are well under this. */
const MAX_VOICE_NAME = 200;

/** Opt-in cloud services; local is always on and always the fallback. */
export const CLOUD_PROVIDERS = ["gemini", "elevenlabs", "backboard"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
/** Backboard learning memory: off, read and write, or recall only. */
export const MEMORY_MODES = ["off", "auto", "readonly"] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];
export const MAX_SENSITIVE_APPS = 40;
export const MAX_SENSITIVE_APP = 60;
/** Apps and sites matched (case-insensitive) against the active app and window title; cloud stays off there. */
export const DEFAULT_SENSITIVE_APPS = ["1Password", "Bitwarden", "KeePass", "LastPass", "Dashlane", "Bank", "NetBanking", "PayPal", "Paytm", "PhonePe", "Credential Manager", "Password", "Medical", "Health"];

/** Must match DEFAULT_MODEL in src-tauri/src/cloud/gemini.rs. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
/** Must match DEFAULT_MODEL in src-tauri/src/cloud/elevenlabs.rs. */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5";
/** "Sarah", a stock voice every account has. Must match DEFAULT_VOICE_ID in src-tauri/src/cloud/elevenlabs.rs. */
export const DEFAULT_ELEVENLABS_VOICE = "EXAVITQu4vr4xnSDxMaL";
/** Must match MAX_MODEL_CHARS in src-tauri/src/cloud/gemini.rs and MAX_ID_CHARS in elevenlabs.rs. */
export const MAX_GEMINI_MODEL = 80;
export const MAX_ELEVENLABS_ID = 64;
/** The charsets Rust accepts before putting an id in a URL. */
const GEMINI_MODEL_ID = /^[A-Za-z0-9._-]+$/;
const ELEVENLABS_MODEL_ID = /^[A-Za-z0-9_]+$/;
const ELEVENLABS_VOICE_ID = /^[A-Za-z0-9]+$/;

export const DEFAULT_CLOUD = {
  reasoning: false,
  voice: false,
  memory: "off",
  sensitiveApps: DEFAULT_SENSITIVE_APPS,
  geminiModel: DEFAULT_GEMINI_MODEL,
  elevenlabsModel: DEFAULT_ELEVENLABS_MODEL,
  elevenlabsVoice: DEFAULT_ELEVENLABS_VOICE,
} as const;

const cloudId = (max: number, charset: RegExp, fallback: string) => z.string().trim().min(1).max(max).regex(charset).catch(fallback);

const cloudSchema = z
  .object({
    /** Gemini reasoning (text context only). */
    reasoning: z.boolean().catch(false),
    /** ElevenLabs voice (Hodey's words only). */
    voice: z.boolean().catch(false),
    memory: z.enum(MEMORY_MODES).catch("off"),
    sensitiveApps: z.array(z.string().trim().min(1).max(MAX_SENSITIVE_APP)).max(MAX_SENSITIVE_APPS).catch([...DEFAULT_SENSITIVE_APPS]),
    /** The Gemini model Hodey asks (an id from Gemini's model list, without "models/"). */
    geminiModel: cloudId(MAX_GEMINI_MODEL, GEMINI_MODEL_ID, DEFAULT_GEMINI_MODEL),
    elevenlabsModel: cloudId(MAX_ELEVENLABS_ID, ELEVENLABS_MODEL_ID, DEFAULT_ELEVENLABS_MODEL),
    elevenlabsVoice: cloudId(MAX_ELEVENLABS_ID, ELEVENLABS_VOICE_ID, DEFAULT_ELEVENLABS_VOICE),
  })
  .default({ ...DEFAULT_CLOUD, sensitiveApps: [...DEFAULT_SENSITIVE_APPS] });

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
    /** What the learner speaks and Hodey answers in; "auto" detects it from each thing the learner says. */
    language: z.enum(SPEECH_LANGUAGES).catch("auto").default("auto"),
    /** How Hindi words are shown: in Devanagari, or in English letters ("click kijiye"). Speech is the same. */
    hindiScript: z.enum(HINDI_SCRIPTS).catch("devanagari").default("devanagari"),
    /** The natural voice for Hindi and Hinglish sentences (Kokoro's Hindi speakers). */
    hindiVoice: z.string().max(MAX_VOICE_NAME).default(DEFAULT_HINDI_VOICE),
    /** Extra names for Hodey ("Hey Hodes"), recognised like "Hey Hodey". */
    wakeWords: z.array(z.string().trim().min(1).max(MAX_WAKE_WORD)).max(MAX_WAKE_WORDS).default([]),
  }),
  /** How new Hodes run by default; each Hode can still pick its own. */
  mode: z.enum(HODE_MODES).catch("teach").default("teach"),
  /** Agent mode guides every step, or does them and stops at checkpoints for the learner to check. */
  agentStyle: z.enum(AGENT_STYLES).catch("guide").default("guide"),
  /** How long Hodey waits without progress before offering more help. */
  stuckSeconds: z.number().int().min(MIN_STUCK_SECONDS).max(MAX_STUCK_SECONDS),
  appearance: appearanceSchema,
  /** Off by default: when on, only a scrubbed, generic query leaves the PC. */
  webSearch: z.boolean().default(false),
  /** Hold to talk; with a letter for commands. */
  hodeyKey: z.enum(HODEY_KEYS).catch("right-ctrl").default("right-ctrl"),
  cloud: cloudSchema,
});

export type Settings = z.infer<typeof settingsSchema>;
export type Appearance = Settings["appearance"];
export type CloudSettings = Settings["cloud"];

export const DEFAULT_SETTINGS: Settings = {
  voice: { enabled: true, rate: 1.05, name: "", conversation: true, handsFree: false, language: "auto", hindiScript: "devanagari", hindiVoice: DEFAULT_HINDI_VOICE, wakeWords: [] },
  mode: "teach",
  agentStyle: "guide",
  stuckSeconds: 12,
  appearance: { ...DEFAULT_APPEARANCE },
  webSearch: false,
  hodeyKey: "right-ctrl",
  cloud: { ...DEFAULT_CLOUD, sensitiveApps: [...DEFAULT_SENSITIVE_APPS] },
};

export const SETTINGS_LIMITS = { MIN_RATE, MAX_RATE, MIN_STUCK_SECONDS, MAX_STUCK_SECONDS } as const;

/** Saved settings, field by field: anything missing or invalid falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const result = settingsSchema.shape[key].safeParse(value[key]);
    return (result.success ? result.data : DEFAULT_SETTINGS[key]) as Settings[K];
  };
  return { voice: pick("voice"), mode: pick("mode"), agentStyle: pick("agentStyle"), stuckSeconds: pick("stuckSeconds"), appearance: pick("appearance"), webSearch: pick("webSearch"), hodeyKey: pick("hodeyKey"), cloud: pick("cloud") };
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
