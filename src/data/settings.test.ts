import { describe, expect, it } from "vitest";
import { DEFAULT_ELEVENLABS_MODEL, DEFAULT_ELEVENLABS_VOICE, DEFAULT_GEMINI_MODEL, DEFAULT_SETTINGS, MAX_GEMINI_MODEL, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("fills in fields added after a row was saved", () => {
    const old = { voice: { enabled: false, rate: 1.2 }, help: "guided", stuckSeconds: 20 };
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, voice: { enabled: false, rate: 1.2, name: "", conversation: true, handsFree: false, language: "auto", hindiScript: "devanagari", hindiVoice: "kokoro:31", wakeWords: [] }, mode: "teach", stuckSeconds: 20 });
  });

  it("keeps cloud off for rows saved before cloud settings existed", () => {
    expect(parseSettings({ stuckSeconds: 20 }).cloud).toEqual(DEFAULT_SETTINGS.cloud);
    expect(DEFAULT_SETTINGS.cloud).toMatchObject({ reasoning: false, voice: false, memory: "off" });
  });

  it("replaces an invalid memory mode without losing the other cloud choices", () => {
    const cloud = parseSettings({ cloud: { reasoning: true, voice: false, memory: "always", sensitiveApps: ["Bank"] } }).cloud;
    expect(cloud).toEqual({ ...DEFAULT_SETTINGS.cloud, reasoning: true, voice: false, memory: "off", sensitiveApps: ["Bank"] });
  });

  it("defaults the cloud models and voice for rows saved before they could be chosen", () => {
    const cloud = parseSettings({ cloud: { reasoning: true, voice: true, memory: "auto", sensitiveApps: [] } }).cloud;
    expect(cloud).toMatchObject({ reasoning: true, geminiModel: DEFAULT_GEMINI_MODEL, elevenlabsModel: DEFAULT_ELEVENLABS_MODEL, elevenlabsVoice: DEFAULT_ELEVENLABS_VOICE });
    expect(DEFAULT_SETTINGS.cloud).toMatchObject({ geminiModel: "gemini-3.8-flash", elevenlabsModel: "eleven_flash_v2_5", elevenlabsVoice: "EXAVITQu4vr4xnSDxMaL" });
  });

  it("keeps a chosen model and voice, including the previous Gemini default", () => {
    const chosen = { geminiModel: "gemini-3.7-flash", elevenlabsModel: "eleven_multilingual_v2", elevenlabsVoice: "JBFqnCBsd6RMkjVDRZzb" };
    expect(parseSettings({ cloud: { ...DEFAULT_SETTINGS.cloud, ...chosen } }).cloud).toMatchObject(chosen);
  });

  it("replaces only the ids that Rust would refuse to put in a URL", () => {
    const odd = { geminiModel: "x/../../evil?y", elevenlabsModel: "eleven_flash_v2_5", elevenlabsVoice: "bad id" };
    expect(parseSettings({ cloud: { ...DEFAULT_SETTINGS.cloud, ...odd } }).cloud).toMatchObject({ geminiModel: DEFAULT_GEMINI_MODEL, elevenlabsModel: "eleven_flash_v2_5", elevenlabsVoice: DEFAULT_ELEVENLABS_VOICE });
    const long = { ...DEFAULT_SETTINGS.cloud, geminiModel: "g".repeat(MAX_GEMINI_MODEL + 1), elevenlabsModel: 7 };
    expect(parseSettings({ cloud: long }).cloud).toMatchObject({ geminiModel: DEFAULT_GEMINI_MODEL, elevenlabsModel: DEFAULT_ELEVENLABS_MODEL });
  });

  it("replaces only the invalid appearance fields", () => {
    const saved = { appearance: { theme: "light", accent: "neon", hodeyColor: "mint", hodeyAccessory: "crown" } };
    expect(parseSettings(saved).appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: "light", hodeyColor: "mint" });
  });
});
