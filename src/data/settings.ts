import { z } from "zod";
import type { AssistanceLevel } from "../lib/types";

/** PRD §6: learner-selected difficulty. */
export const HELP_PRESETS = ["beginner", "guided", "confident"] as const;
export type HelpPreset = (typeof HELP_PRESETS)[number];

/** Where a brand-new skill starts on the assistance ladder for each preset. */
export const PRESET_START_LEVEL: Record<HelpPreset, AssistanceLevel> = {
  beginner: "demonstrate",
  guided: "guide",
  confident: "hint",
};

const MIN_RATE = 0.6;
const MAX_RATE = 1.6;
const MIN_STUCK_SECONDS = 5;
const MAX_STUCK_SECONDS = 60;

export const settingsSchema = z.object({
  voice: z.object({ enabled: z.boolean(), rate: z.number().min(MIN_RATE).max(MAX_RATE) }),
  help: z.enum(HELP_PRESETS),
  /** How long Hodey waits without progress before offering more help. */
  stuckSeconds: z.number().int().min(MIN_STUCK_SECONDS).max(MAX_STUCK_SECONDS),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  voice: { enabled: true, rate: 1.05 },
  help: "beginner",
  stuckSeconds: 12,
};

export const SETTINGS_LIMITS = { MIN_RATE, MAX_RATE, MIN_STUCK_SECONDS, MAX_STUCK_SECONDS } as const;

/** Saved settings, field by field: anything missing or invalid falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const pick = <K extends keyof Settings>(key: K): Settings[K] => {
    const result = settingsSchema.shape[key].safeParse(value[key]);
    return (result.success ? result.data : DEFAULT_SETTINGS[key]) as Settings[K];
  };
  return { voice: pick("voice"), help: pick("help"), stuckSeconds: pick("stuckSeconds") };
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
