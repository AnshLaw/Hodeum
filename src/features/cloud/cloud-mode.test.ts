import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../data/settings";
import { cloudMode, withCloudMode } from "./cloud-mode";

const LOCAL = DEFAULT_SETTINGS.cloud;
const ALL_KEYS = { gemini: true, elevenlabs: true, backboard: true };

describe("cloudMode", () => {
  it("is local until some cloud service is on", () => {
    expect(cloudMode(LOCAL)).toBe("local");
    expect(cloudMode({ ...LOCAL, voice: true })).toBe("cloud");
    expect(cloudMode({ ...LOCAL, memory: "readonly" })).toBe("cloud");
  });
});

describe("withCloudMode", () => {
  it("turns on each service that has a saved key", () => {
    const cloud = withCloudMode(LOCAL, "cloud", { gemini: true, elevenlabs: false, backboard: true });
    expect(cloud).toMatchObject({ reasoning: true, voice: false, memory: "auto" });
  });

  it("keeps a memory mode already chosen", () => {
    expect(withCloudMode({ ...LOCAL, memory: "readonly" }, "cloud", ALL_KEYS).memory).toBe("readonly");
  });

  it("goes fully local, keeping the chosen models for next time", () => {
    const on = { ...withCloudMode(LOCAL, "cloud", ALL_KEYS), geminiModel: "gemini-2.5-pro" };
    const off = withCloudMode(on, "local", ALL_KEYS);
    expect(off).toMatchObject({ reasoning: false, voice: false, memory: "off", geminiModel: "gemini-2.5-pro" });
  });
});
