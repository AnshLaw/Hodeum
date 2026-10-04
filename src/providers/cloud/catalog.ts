import { z } from "zod";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Must match the commands in src-tauri/src/cloud/catalog.rs and elevenlabs.rs. */
const GEMINI_MODELS = "gemini_list_models";
const ELEVENLABS_MODELS = "elevenlabs_list_models";
const ELEVENLABS_VOICES = "elevenlabs_list_voices";
const SPEAK = "elevenlabs_speak";
/** A fixed sentence, so a preview never sends anything of the learner's. */
export const VOICE_PREVIEW_TEXT = "Hi, I'm Hodey. Let's learn this together, one step at a time.";
const PREVIEW_SPEED = 1;

const geminiModelSchema = z.object({ id: z.string().min(1), displayName: z.string(), description: z.string().optional() });
const elevenLabsModelSchema = z.object({ id: z.string().min(1), name: z.string(), multilingual: z.boolean() });
const elevenLabsVoiceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: z.string(),
  labels: z.object({ accent: z.string().optional(), gender: z.string().optional() }),
});

/** Mirrors the structs in src-tauri/src/cloud/catalog.rs. */
export type GeminiModel = z.infer<typeof geminiModelSchema>;
export type ElevenLabsModel = z.infer<typeof elevenLabsModelSchema>;
export type ElevenLabsVoice = z.infer<typeof elevenLabsVoiceSchema>;

export interface VoiceChoice {
  model: string;
  voice: string;
}

/** What the learner can pick in Settings > Cloud. Lists come from the provider with the saved key. */
export interface CloudCatalog {
  geminiModels(): Promise<GeminiModel[]>;
  elevenlabsModels(): Promise<ElevenLabsModel[]>;
  elevenlabsVoices(): Promise<ElevenLabsVoice[]>;
  /** Says VOICE_PREVIEW_TEXT with this model and voice. */
  previewVoice(choice: VoiceChoice): Promise<void>;
}

function parseList<T>(schema: z.ZodType<T>, raw: unknown, what: string): T[] {
  const result = z.array(schema).safeParse(raw);
  if (!result.success) throw new Error(`The ${what} list came back in an unexpected shape`);
  return result.data;
}

/** The lists over the Rust bridge: the key stays in Windows Credential Manager. */
export class TauriCloudCatalog implements CloudCatalog {
  constructor(private readonly invoke: Invoke) {}

  async geminiModels(): Promise<GeminiModel[]> {
    return parseList(geminiModelSchema, await this.invoke<unknown>(GEMINI_MODELS), "Gemini model");
  }

  async elevenlabsModels(): Promise<ElevenLabsModel[]> {
    return parseList(elevenLabsModelSchema, await this.invoke<unknown>(ELEVENLABS_MODELS), "ElevenLabs model");
  }

  async elevenlabsVoices(): Promise<ElevenLabsVoice[]> {
    return parseList(elevenLabsVoiceSchema, await this.invoke<unknown>(ELEVENLABS_VOICES), "ElevenLabs voice");
  }

  async previewVoice({ model, voice }: VoiceChoice): Promise<void> {
    await this.invoke<boolean>(SPEAK, { text: VOICE_PREVIEW_TEXT, speed: PREVIEW_SPEED, model, voiceId: voice });
  }
}
