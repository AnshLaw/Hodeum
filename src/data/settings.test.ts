import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

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
    expect(cloud).toEqual({ reasoning: true, voice: false, memory: "off", sensitiveApps: ["Bank"] });
  });

  it("replaces only the invalid appearance fields", () => {
    const saved = { appearance: { theme: "light", accent: "neon", hodeyColor: "mint", hodeyAccessory: "crown" } };
    expect(parseSettings(saved).appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: "light", hodeyColor: "mint" });
  });
});
