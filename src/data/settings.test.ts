import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseSettings } from "./settings";

describe("parseSettings", () => {
  it("fills in fields added after a row was saved", () => {
    const old = { voice: { enabled: false, rate: 1.2 }, help: "guided", stuckSeconds: 20 };
    expect(parseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, voice: { enabled: false, rate: 1.2, name: "", conversation: true, handsFree: false, language: "en", wakeWords: [] }, mode: "teach", stuckSeconds: 20 });
  });

  it("replaces only the invalid appearance fields", () => {
    const saved = { appearance: { theme: "light", accent: "neon", hodeyColor: "mint", hodeyAccessory: "crown" } };
    expect(parseSettings(saved).appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: "light", hodeyColor: "mint" });
  });
});
