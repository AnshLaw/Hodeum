import type { CloudKeyService } from "../app/services";
import type { CloudProvider } from "../data/settings";
import type { CloudCatalog, ElevenLabsModel, ElevenLabsVoice, GeminiModel } from "../providers/cloud/catalog";
import { NO_KEYS, type KeyPresence } from "../providers/cloud/keys";

/** Typing this key in the practice stage fails the save, to rehearse the error message. */
export const PRACTICE_FAILING_KEY = "fail";

/** The stage's stand-in for Windows Credential Manager: it keeps only whether a key was saved. */
export class PracticeCloudKeys implements CloudKeyService {
  private presence: KeyPresence = NO_KEYS;

  current(): KeyPresence {
    return this.presence;
  }

  async refresh(): Promise<KeyPresence> {
    return this.presence;
  }

  async save(provider: CloudProvider, key: string): Promise<void> {
    if (key === PRACTICE_FAILING_KEY) throw new Error("the practice stage refused this key on purpose");
    this.presence = { ...this.presence, [provider]: true };
  }

  async clear(provider: CloudProvider): Promise<void> {
    this.presence = { ...this.presence, [provider]: false };
  }
}

/** Long enough to see "Loading…" in the stage. */
const PRACTICE_LIST_DELAY_MS = 400;
const NO_KEY: Record<"gemini" | "elevenlabs", string> = { gemini: "No Gemini key is saved.", elevenlabs: "No ElevenLabs key is saved." };

export const PRACTICE_GEMINI_MODELS: GeminiModel[] = [
  { id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", description: "Practice stage stand-in." },
  { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" },
  { id: "gemini-3.8-pro", displayName: "Gemini 3.8 Pro" },
];
export const PRACTICE_ELEVENLABS_MODELS: ElevenLabsModel[] = [
  { id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", multilingual: true },
  { id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", multilingual: true },
  { id: "eleven_monolingual_v1", name: "Eleven English v1", multilingual: false },
];
export const PRACTICE_ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { accent: "american", gender: "female" } },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", category: "premade", labels: { accent: "british", gender: "male" } },
  { id: "PracticeClone01", name: "My practice clone", category: "cloned", labels: {} },
];

/** Fake model and voice lists, shown only once a (practice) key is saved, like the real ones. */
export class PracticeCloudCatalog implements CloudCatalog {
  constructor(
    private readonly keys: PracticeCloudKeys,
    private readonly delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async list<T>(provider: "gemini" | "elevenlabs", items: T[]): Promise<T[]> {
    await this.delay(PRACTICE_LIST_DELAY_MS);
    if (!this.keys.current()[provider]) throw new Error(NO_KEY[provider]);
    return items.map((item) => ({ ...item }));
  }

  geminiModels(): Promise<GeminiModel[]> {
    return this.list("gemini", PRACTICE_GEMINI_MODELS);
  }

  elevenlabsModels(): Promise<ElevenLabsModel[]> {
    return this.list("elevenlabs", PRACTICE_ELEVENLABS_MODELS);
  }

  elevenlabsVoices(): Promise<ElevenLabsVoice[]> {
    return this.list("elevenlabs", PRACTICE_ELEVENLABS_VOICES);
  }

  async previewVoice(): Promise<void> {
    throw new Error("ElevenLabs previews play only in the Hodeum app; the practice stage has no cloud voice.");
  }
}
