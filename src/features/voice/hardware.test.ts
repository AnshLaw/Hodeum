import { describe, expect, it, vi } from "vitest";
import { TauriVoiceHardware, applyVoiceHardware, deviceChoices, modelChoices, withVoiceChange } from "./hardware";
import { DEFAULT_SETTINGS } from "../../data/settings";

const MIC = { id: "{mic}", name: "Microphone (G733)", isDefault: true };
const WEBCAM = { id: "{cam}", name: "Webcam mic", isDefault: false };

describe("deviceChoices", () => {
  it("offers the system default first, then each device", () => {
    expect(deviceChoices([MIC, WEBCAM], "")).toEqual([
      { value: "", label: "System default", detail: "Microphone (G733)" },
      { value: "{mic}", label: "Microphone (G733)" },
      { value: "{cam}", label: "Webcam mic" },
    ]);
  });

  it("keeps a saved device that's unplugged, marked as missing", () => {
    expect(deviceChoices([MIC], "{gone}").at(-1)).toEqual({ value: "{gone}", label: "Saved device", detail: "Not connected", disabled: true });
  });
});

describe("modelChoices", () => {
  it("lists the speech models, the ones not installed greyed out", () => {
    const models = { asr: [{ id: "nemotron", label: "Nemotron", available: true }, { id: "whisper", label: "Whisper", available: false }], active: "nemotron" };
    expect(modelChoices(models)).toEqual([
      { value: "nemotron", label: "Nemotron" },
      { value: "whisper", label: "Whisper", detail: "Not installed", disabled: true },
    ]);
  });
});

describe("TauriVoiceHardware", () => {
  it("reads devices and models, rejecting an unexpected shape", async () => {
    const invoke = vi.fn(async (command: string) => (command === "audio_devices" ? { inputs: [MIC], outputs: [] } : { asr: "nope" }));
    const hardware = new TauriVoiceHardware(invoke as never);
    expect(await hardware.devices()).toEqual({ inputs: [MIC], outputs: [] });
    await expect(hardware.models()).rejects.toThrow("unexpected shape");
  });
});

describe("applyVoiceHardware", () => {
  it("sends the chosen devices (null for the default) and the chosen speech model", async () => {
    const invoke = vi.fn(async () => undefined);
    await applyVoiceHardware(invoke as never, { ...DEFAULT_SETTINGS.voice, inputDevice: "{mic}", asrModel: "whisper" });
    expect(invoke).toHaveBeenCalledWith("set_audio_devices", { input: "{mic}", output: null });
    expect(invoke).toHaveBeenCalledWith("set_asr_model", { id: "whisper" });
  });

  it("leaves the speech model to the engine when none was picked", async () => {
    const invoke = vi.fn(async () => undefined);
    await applyVoiceHardware(invoke as never, DEFAULT_SETTINGS.voice);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("withVoiceChange", () => {
  it("changes only the voice fields given", () => {
    const next = withVoiceChange(DEFAULT_SETTINGS, { outputDevice: "{spk}" });
    expect(next.voice).toEqual({ ...DEFAULT_SETTINGS.voice, outputDevice: "{spk}" });
    expect(next.mode).toBe(DEFAULT_SETTINGS.mode);
  });
});
