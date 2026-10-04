import { describe, expect, it, vi } from "vitest";
import type { TTSProvider } from "../interfaces";
import { NativeSpeechInput, NativeTTSProvider, RoutedTTS, voiceChoice, type VoiceBridge, type VoiceStatus } from "./native-voice";

const READY: VoiceStatus = { asr: "ready", tts: "ready", listening: false, detail: null, tts_detail: null, voices: [{ id: "kokoro:3", label: "Heart · American" }] };

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeBridge(status: VoiceStatus = READY) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>) => (command === "voice_status" ? status : undefined));
  const bridge: VoiceBridge = {
    invoke: invoke as VoiceBridge["invoke"],
    listen: (event, handler) => {
      const set = listeners.get(event) ?? new Set();
      set.add(handler as (payload: unknown) => void);
      listeners.set(event, set);
      return () => set.delete(handler as (payload: unknown) => void);
    },
  };
  const fire = (event: string, payload: unknown) => listeners.get(event)?.forEach((h) => h(payload));
  return { bridge, invoke, fire };
}

async function* words(text: string): AsyncGenerator<string> {
  yield text;
}

describe("NativeSpeechInput", () => {
  it("is unavailable, with the reason, until the speech models are installed", async () => {
    const { bridge } = fakeBridge({ ...READY, asr: "missing", detail: "Run setup" });
    const speech = new NativeSpeechInput(bridge);
    await settle();
    expect(speech.status()).toBe("unavailable");
    expect(speech.unavailableReason()).toBe("Run setup");
  });

  it("follows listening status and relays transcripts and speech starts", async () => {
    const { bridge, fire, invoke } = fakeBridge();
    const speech = new NativeSpeechInput(bridge);
    await settle();
    const statuses: string[] = [];
    const texts: [string, boolean][] = [];
    const starts = vi.fn();
    speech.onStatus((s) => statuses.push(s));
    speech.onTranscript((text, final) => texts.push([text, final]));
    speech.onSpeechStart(starts);
    await speech.start();
    expect(invoke).toHaveBeenCalledWith("voice_start");
    fire("voice:status", { ...READY, listening: true });
    fire("voice:speech-start", null);
    fire("voice:transcript", { text: "give me a", final: false });
    fire("voice:transcript", { text: "give me a hint", final: true });
    expect(statuses).toEqual(["listening"]);
    expect(starts).toHaveBeenCalledOnce();
    expect(texts).toEqual([["give me a", false], ["give me a hint", true]]);
  });
});

describe("NativeTTSProvider", () => {
  it("speaks through Supertonic and resolves when that utterance is done", async () => {
    const { bridge, fire, invoke } = fakeBridge();
    const tts = new NativeTTSProvider(bridge);
    tts.voiceId = "kokoro:26";
    tts.rate = 1.2;
    let done = false;
    const speaking = tts.speak(words("Click Insert."), new AbortController().signal).then(() => (done = true));
    await settle();
    const call = invoke.mock.calls.find(([command]) => command === "tts_speak");
    const args = call?.[1] as { id: string };
    expect(args).toMatchObject({ text: "Click Insert.", voiceId: "kokoro:26", speed: 1.2 });
    fire("tts:done", { id: "someone-else", interrupted: false, error: null });
    await settle();
    expect(done).toBe(false);
    fire("tts:done", { id: args.id, interrupted: false, error: null });
    await speaking;
    expect(done).toBe(true);
  });

  it("stops natively when the utterance is aborted (barge-in)", async () => {
    const { bridge, invoke } = fakeBridge();
    const tts = new NativeTTSProvider(bridge);
    const controller = new AbortController();
    const speaking = tts.speak(words("A long explanation."), controller.signal);
    await settle();
    controller.abort();
    await speaking;
    expect(invoke).toHaveBeenCalledWith("tts_stop");
  });
});

describe("RoutedTTS", () => {
  const fake = (fail = false): TTSProvider & { said: string[] } => {
    const said: string[] = [];
    return {
      said,
      async speak(text) {
        for await (const t of text) said.push(t);
        if (fail) throw new Error("no audio device");
      },
      stop: vi.fn(async () => undefined),
      healthCheck: async () => true,
    };
  };

  it("uses the natural voice when it's ready, Windows voices otherwise", async () => {
    const natural = fake();
    const windows = fake();
    let ready = true;
    const tts = new RoutedTTS(natural, windows, () => ready);
    await tts.speak(words("one"), new AbortController().signal);
    ready = false;
    await tts.speak(words("two"), new AbortController().signal);
    expect(natural.said).toEqual(["one"]);
    expect(windows.said).toEqual(["two"]);
  });

  it("falls back to Windows voices for an utterance the natural voice couldn't say", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const windows = fake();
    await new RoutedTTS(fake(true), windows, () => true).speak(words("hello"), new AbortController().signal);
    expect(windows.said).toEqual(["hello"]);
    errorLog.mockRestore();
  });
});

describe("voiceChoice", () => {
  it("reads Hodey's natural voices, Windows voices, and the default", () => {
    expect(voiceChoice("")).toEqual({ engine: "natural", id: "" });
    expect(voiceChoice("hodey:kokoro:26")).toEqual({ engine: "natural", id: "kokoro:26" });
    expect(voiceChoice("hodey:4")).toEqual({ engine: "natural", id: "4" });
    expect(voiceChoice("Microsoft Zira - English (United States)")).toEqual({ engine: "windows", uri: "Microsoft Zira - English (United States)" });
  });
});
