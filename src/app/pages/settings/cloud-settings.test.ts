import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVE_APPS, DEFAULT_SETTINGS, MAX_SENSITIVE_APP, MAX_SENSITIVE_APPS } from "../../../data/settings";
import { NO_KEYS } from "../../../providers/cloud/keys";
import {
  CLOUD_ROWS,
  MAX_KEY_CHARS,
  addSensitiveApp,
  controlEnabled,
  isDefaultSensitiveApps,
  keyDraftError,
  keyErrorMessage,
  keyStatusLabel,
  removeSensitiveApp,
  resetSensitiveApps,
  withKeyCleared,
  withProvider,
} from "./cloud-settings";

const CLOUD = DEFAULT_SETTINGS.cloud;

describe("cloud settings view", () => {
  it("lists Gemini, ElevenLabs and Backboard with what each one is for", () => {
    expect(CLOUD_ROWS.map((row) => [row.provider, row.name, row.role])).toEqual([
      ["gemini", "Gemini", "Reasoning"],
      ["elevenlabs", "ElevenLabs", "Voice"],
      ["backboard", "Backboard", "Memory"],
    ]);
  });

  it("labels key presence", () => {
    expect(keyStatusLabel(true)).toBe("Key saved");
    expect(keyStatusLabel(false)).toBe("No key");
  });

  it("keeps a provider's control disabled until its key is saved", () => {
    expect(controlEnabled(undefined, "gemini")).toBe(false);
    expect(controlEnabled(NO_KEYS, "gemini")).toBe(false);
    expect(controlEnabled({ ...NO_KEYS, gemini: true }, "gemini")).toBe(true);
    expect(controlEnabled({ ...NO_KEYS, gemini: true }, "backboard")).toBe(false);
  });

  it("sets each provider's own setting", () => {
    expect(withProvider(CLOUD, "gemini", true).reasoning).toBe(true);
    expect(withProvider(CLOUD, "elevenlabs", true).voice).toBe(true);
    expect(withProvider(CLOUD, "backboard", "readonly").memory).toBe("readonly");
    expect(withProvider(CLOUD, "gemini", true).sensitiveApps).toEqual(CLOUD.sensitiveApps);
  });

  it("turns a provider off when its key is cleared", () => {
    const on = { ...CLOUD, reasoning: true, voice: true, memory: "auto" as const };
    expect(withKeyCleared(on, "gemini")).toMatchObject({ reasoning: false, voice: true, memory: "auto" });
    expect(withKeyCleared(on, "elevenlabs")).toMatchObject({ reasoning: true, voice: false });
    expect(withKeyCleared(on, "backboard").memory).toBe("off");
  });
});

describe("key drafts", () => {
  it("accepts a plain key and rejects blanks, spaces and very long text", () => {
    expect(keyDraftError("AIza-abc_123")).toBeUndefined();
    expect(keyDraftError("  AIza-abc  ")).toBeUndefined();
    expect(keyDraftError("")).toBe("Paste a key first.");
    expect(keyDraftError("   ")).toBe("Paste a key first.");
    expect(keyDraftError("two words")).toBe("Keys don't contain spaces.");
    expect(keyDraftError("x".repeat(MAX_KEY_CHARS + 1))).toBe("That's too long to be a key.");
  });

  it("explains a failed save without ever echoing the key", () => {
    const message = keyErrorMessage(new Error("Credential Manager is locked"), "save");
    expect(message).toBe("Couldn't save the key: Credential Manager is locked");
    expect(keyErrorMessage("nope", "clear")).toBe("Couldn't remove the key: nope");
  });
});

describe("sensitive apps", () => {
  it("adds a trimmed name and refuses blanks and duplicates (any case)", () => {
    expect(addSensitiveApp(["Bank"], "  Signal ")).toEqual({ apps: ["Bank", "Signal"] });
    expect(addSensitiveApp(["Bank"], "  ")).toEqual({ error: "Type an app or site name." });
    expect(addSensitiveApp(["Bank"], "bank")).toEqual({ error: "Bank is already on the list." });
  });

  it("enforces the length and count limits from settings", () => {
    expect(addSensitiveApp([], "x".repeat(MAX_SENSITIVE_APP + 1))).toEqual({ error: `Keep it under ${MAX_SENSITIVE_APP + 1} characters.` });
    const full = Array.from({ length: MAX_SENSITIVE_APPS }, (_, i) => `App ${i}`);
    expect(addSensitiveApp(full, "One more")).toEqual({ error: "The list is full. Remove one first." });
  });

  it("removes one and resets to the defaults", () => {
    expect(removeSensitiveApp(["Bank", "Signal"], "Bank")).toEqual(["Signal"]);
    const reset = resetSensitiveApps();
    expect(reset).toEqual(DEFAULT_SENSITIVE_APPS);
    expect(reset).not.toBe(DEFAULT_SENSITIVE_APPS);
    expect(isDefaultSensitiveApps(reset)).toBe(true);
    expect(isDefaultSensitiveApps(["Bank"])).toBe(false);
  });
});
