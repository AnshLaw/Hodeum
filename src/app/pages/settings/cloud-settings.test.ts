import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVE_APPS, DEFAULT_SETTINGS, MAX_SENSITIVE_APP, MAX_SENSITIVE_APPS } from "../../../data/settings";
import { NO_KEYS } from "../../../providers/cloud/keys";
import {
  CLOUD_ROWS,
  MAX_KEY_CHARS,
  RECOMMENDED_SUFFIX,
  addSensitiveApp,
  catalogErrorMessage,
  catalogStatus,
  elevenLabsModelOption,
  geminiOption,
  linkLabel,
  pickerOptions,
  voiceOption,
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

describe("cloud model and voice pickers", () => {
  const listed = [
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
  ];

  it("links each provider to its official key page", () => {
    expect(CLOUD_ROWS.map((row) => row.keyUrl)).toEqual(["https://aistudio.google.com/app/apikey", "https://elevenlabs.io/app/settings/api-keys", "https://app.backboard.io"]);
    expect(linkLabel("https://aistudio.google.com/app/apikey")).toBe("aistudio.google.com/app/apikey");
  });

  it("marks the recommended default", () => {
    expect(pickerOptions(listed, "gemini-3.7-flash", "gemini-3.8-flash")).toEqual([
      { value: "gemini-3.8-flash", label: `Gemini 3.8 Flash${RECOMMENDED_SUFFIX}` },
      { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    ]);
  });

  it("keeps the current choice selectable when the list lacks it or failed", () => {
    expect(pickerOptions(listed, "gemini-2.5-pro", "gemini-3.8-flash")[0]).toEqual({ value: "gemini-2.5-pro", label: "gemini-2.5-pro" });
    expect(pickerOptions([], "gemini-3.5-flash-lite", "gemini-3.5-flash-lite")).toEqual([{ value: "gemini-3.5-flash-lite", label: `Gemini 3.5 Flash-Lite${RECOMMENDED_SUFFIX}` }]);
    expect(pickerOptions([], "EXAVITQu4vr4xnSDxMaL", "EXAVITQu4vr4xnSDxMaL")[0].label).toBe(`Sarah${RECOMMENDED_SUFFIX}`);
  });

  it("labels models and voices by name", () => {
    expect(geminiOption({ id: "gemini-3.8-flash", displayName: "Gemini 3.8 Flash" })).toEqual({ value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" });
    expect(geminiOption({ id: "gemini-x", displayName: "" }).label).toBe("gemini-x");
    expect(elevenLabsModelOption({ id: "eleven_flash_v2_5", name: "Eleven Flash v2.5", multilingual: true }).label).toBe("Eleven Flash v2.5");
    expect(elevenLabsModelOption({ id: "eleven_monolingual_v1", name: "Eleven English v1", multilingual: false }).label).toBe("Eleven English v1 · English only");
    expect(voiceOption({ id: "a1", name: "Sarah", category: "premade", labels: { accent: "american", gender: "female" } }).label).toBe("Sarah · American, female");
    expect(voiceOption({ id: "a2", name: "My clone", category: "cloned", labels: {} }).label).toBe("My clone");
  });

  it("explains every list state with a way forward", () => {
    expect(catalogStatus({ status: "idle" }, "models")).toMatch(/Save a key/);
    expect(catalogStatus({ status: "loading" }, "voices")).toBe("Loading voices…");
    expect(catalogStatus({ status: "error", error: "That key was rejected." }, "models")).toBe("Couldn't load the models: That key was rejected.");
    expect(catalogStatus({ status: "ready", items: [] }, "voices")).toMatch(/No voices found/);
    expect(catalogStatus({ status: "ready", items: [1] }, "voices")).toBeUndefined();
    expect(catalogErrorMessage("No Gemini key is saved.")).toBe("No Gemini key is saved.");
    expect(catalogErrorMessage(new Error("offline"))).toBe("offline");
  });
});
