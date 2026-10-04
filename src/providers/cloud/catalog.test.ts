import { describe, expect, it, vi } from "vitest";
import { TauriCloudCatalog, VOICE_PREVIEW_TEXT } from "./catalog";

type Invoke = ConstructorParameters<typeof TauriCloudCatalog>[0];
const catalogWith = (reply: unknown) => {
  const invoke = vi.fn(async () => reply);
  return { invoke, catalog: new TauriCloudCatalog(invoke as unknown as Invoke) };
};

describe("TauriCloudCatalog", () => {
  it("lists Gemini models through Rust", async () => {
    const models = [{ id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash", description: "Fast." }, { id: "gemini-3.7-flash", displayName: "Gemini 3.7 Flash" }];
    const { invoke, catalog } = catalogWith(models);
    expect(await catalog.geminiModels()).toEqual(models);
    expect(invoke).toHaveBeenCalledWith("gemini_list_models");
  });

  it("lists ElevenLabs models and voices through Rust", async () => {
    const models = [{ id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", multilingual: true }];
    expect(await catalogWith(models).catalog.elevenlabsModels()).toEqual(models);
    const voices = [{ id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", category: "premade", labels: { accent: "american", gender: "female" } }];
    const { invoke, catalog } = catalogWith(voices);
    expect(await catalog.elevenlabsVoices()).toEqual(voices);
    expect(invoke).toHaveBeenCalledWith("elevenlabs_list_voices");
  });

  it("rejects a list in an unexpected shape instead of showing junk", async () => {
    await expect(catalogWith([{ name: "no id" }]).catalog.elevenlabsVoices()).rejects.toThrow(/unexpected shape/);
    await expect(catalogWith({ models: [] }).catalog.geminiModels()).rejects.toThrow(/unexpected shape/);
  });

  it("previews a voice with a fixed sentence, never the learner's words", async () => {
    const { invoke, catalog } = catalogWith(false);
    await catalog.previewVoice({ model: "eleven_multilingual_v2", voice: "JBFqnCBsd6RMkjVDRZzb" });
    expect(invoke).toHaveBeenCalledWith("elevenlabs_speak", { text: VOICE_PREVIEW_TEXT, speed: 1, model: "eleven_multilingual_v2", voiceId: "JBFqnCBsd6RMkjVDRZzb" });
  });

  it("passes Rust's readable errors through", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("That key was rejected. Check it, then save it again.");
    });
    await expect(new TauriCloudCatalog(invoke as unknown as Invoke).elevenlabsModels()).rejects.toThrow(/rejected/);
  });
});
