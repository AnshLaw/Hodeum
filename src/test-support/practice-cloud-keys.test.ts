import { describe, expect, it } from "vitest";
import { NO_KEYS } from "../providers/cloud/keys";
import { PRACTICE_ELEVENLABS_VOICES, PRACTICE_FAILING_KEY, PRACTICE_GEMINI_MODELS, PracticeCloudCatalog, PracticeCloudKeys } from "./practice-cloud-keys";

describe("PracticeCloudKeys", () => {
  it("remembers only that a key was saved, never the key", async () => {
    const keys = new PracticeCloudKeys();
    expect(await keys.refresh()).toEqual(NO_KEYS);
    await keys.save("gemini", "AIza-secret");
    expect(keys.current()).toEqual({ ...NO_KEYS, gemini: true });
    expect(JSON.stringify(keys)).not.toContain("AIza");
    await keys.clear("gemini");
    expect(keys.current()).toEqual(NO_KEYS);
  });

  it("fails on purpose for one key, so the error state can be rehearsed", async () => {
    const keys = new PracticeCloudKeys();
    await expect(keys.save("backboard", PRACTICE_FAILING_KEY)).rejects.toThrow(/practice/);
    expect(keys.current().backboard).toBe(false);
  });
});

describe("PracticeCloudCatalog", () => {
  const now = async () => undefined;

  it("lists fake models and voices only once a key is saved", async () => {
    const keys = new PracticeCloudKeys();
    const catalog = new PracticeCloudCatalog(keys, now);
    await expect(catalog.geminiModels()).rejects.toThrow("No Gemini key is saved.");
    await keys.save("gemini", "practice");
    expect(await catalog.geminiModels()).toEqual(PRACTICE_GEMINI_MODELS);
    await expect(catalog.elevenlabsVoices()).rejects.toThrow(/ElevenLabs/);
    await keys.save("elevenlabs", "practice");
    expect(await catalog.elevenlabsVoices()).toEqual(PRACTICE_ELEVENLABS_VOICES);
    expect((await catalog.elevenlabsModels()).some((model) => model.id === "eleven_flash_v2_5")).toBe(true);
  });

  it("says plainly that previews need the real app", async () => {
    await expect(new PracticeCloudCatalog(new PracticeCloudKeys(), now).previewVoice()).rejects.toThrow(/Hodeum app/);
  });
});
