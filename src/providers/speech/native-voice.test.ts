import { describe, expect, it, vi } from "vitest";
import type { SpokenSegment, TTSProvider } from "../interfaces";
import { ActivityTracker } from "../../lib/activity";
import { showStandbyDot } from "./local-voice";
import { spoken } from "../../lib/spoken";
import { fakeSegmentedVoice } from "../../test-support/fake-voice";
import { NativeSpeechInput, NativeTTSProvider, NativeVoiceStatus, RoutedTTS, frequentLines, voiceChoice, type VoiceBridge, type VoiceStatus } from "./native-voice";

const READY: VoiceStatus = {
  asr: "ready",
  tts: "ready",
  listening: false,
  standby: false,
  detail: null,
  tts_detail: null,
  voices: [{ id: "kokoro:3", label: "Heart", description: "American · female" }],
  echoCancelled: false,
  mic: null,
  refine: null,
};

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

  it("switches hands-free and relays overheard sentences for the wake-word check", async () => {
    const { bridge, fire, invoke } = fakeBridge();
    const speech = new NativeSpeechInput(bridge);
    const overheard: string[] = [];
    speech.onWakeCandidate((text, final) => final && overheard.push(text));
    await speech.setHandsFree(true, ["Hey Hodes"]);
    expect(invoke).toHaveBeenCalledWith("set_hands_free", { enabled: true, wakeWords: ["Hey Hodes"] });
    fire("voice:wake-candidate", { text: "Hey Hodey", final: false });
    fire("voice:wake-candidate", { text: "Hey Hodey, give me a hint", final: true });
    expect(overheard).toEqual(["Hey Hodey, give me a hint"]);
  });

  it("keeps the privacy dot on while hands-free waits for a wake word", async () => {
    const { bridge, fire } = fakeBridge();
    const status = new NativeVoiceStatus(bridge);
    await settle();
    const activity = new ActivityTracker();
    showStandbyDot(status, activity);
    fire("voice:status", { ...READY, standby: true });
    expect(activity.current().mic).toBe(true);
  });
});

describe("NativeSpeechInput and the microphone", () => {
  it("knows when Windows cancels Hodey's echo on the open mic", async () => {
    const { bridge, fire } = fakeBridge();
    const speech = new NativeSpeechInput(bridge);
    await settle();
    expect(speech.echoCancelled()).toBe(false);
    fire("voice:status", { ...READY, listening: true, echoCancelled: true, mic: "Microphone Array" });
    expect(speech.echoCancelled()).toBe(true);
  });

  it("warms the echo-cancelled mic and passes speech hints to the GPU's second listen", async () => {
    const { bridge, invoke } = fakeBridge();
    const speech = new NativeSpeechInput(bridge);
    await speech.warmMic();
    await speech.setSpeechHints(["PivotTable", "Insert"]);
    expect(invoke).toHaveBeenCalledWith("voice_warm_mic");
    expect(invoke).toHaveBeenCalledWith("set_speech_hints", { hints: ["PivotTable", "Insert"] });
  });
});

describe("Hodey's frequent lines", () => {
  it("are the acknowledgements and every 'that's right', once each", () => {
    const words = spoken("en");
    const lines = frequentLines(words);
    expect(lines).toContain("Exactly right.");
    expect(lines).toEqual(expect.arrayContaining([...words.acks, ...words.stepDoneLight, words.gotTheHang, words.rememberedOnYourOwn]));
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("are prepared in the learner's voice and speed", async () => {
    const { bridge, invoke } = fakeBridge();
    const tts = new NativeTTSProvider(bridge);
    tts.voiceId = "kokoro:3";
    tts.rate = 1.1;
    await tts.prepare(frequentLines(spoken("en")));
    const call = invoke.mock.calls.find(([command]) => command === "tts_prepare");
    expect(call?.[1]).toMatchObject({ voiceId: "kokoro:3", speed: 1.1 });
    expect((call?.[1] as { texts: string[] }).texts).toContain("Exactly right.");
  });
});

describe("NativeTTSProvider in Hindi", () => {
  it("says Hindi sentences with the Hindi voice and English ones with the chosen voice", async () => {
    const { bridge, invoke } = fakeBridge();
    const tts = new NativeTTSProvider(bridge);
    tts.voiceId = "kokoro:3";
    tts.hindiVoiceId = "kokoro:33";
    tts.speak(words("इंसर्ट टैब खोलिए।"), new AbortController().signal).catch(() => undefined);
    tts.speak(words("Open the Insert tab."), new AbortController().signal).catch(() => undefined);
    await settle();
    const voices = invoke.mock.calls.filter(([command]) => command === "tts_speak").map(([, args]) => (args as { voiceId: string }).voiceId);
    expect(voices).toEqual(["kokoro:33", "kokoro:3"]);
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

describe("NativeTTSProvider segments", () => {
  /** The id the provider gave its latest line (`tts_speak`). */
  const lastSpeakId = (invoke: ReturnType<typeof fakeBridge>["invoke"]) =>
    (invoke.mock.calls.filter(([command]) => command === "tts_speak").at(-1)?.[1] as { id: string }).id;

  function listening() {
    const { bridge, fire, invoke } = fakeBridge();
    const tts = new NativeTTSProvider(bridge);
    const heard: SpokenSegment[] = [];
    const off = tts.onSegment((segment) => heard.push(segment));
    return { tts, fire, invoke, heard, off };
  }

  it("reports each part of the line it's saying as it starts, and nothing of anyone else's", async () => {
    const { tts, fire, invoke, heard } = listening();
    const speaking = tts.speak(words("Nice work so far, now click Insert."), new AbortController().signal);
    await settle();
    const id = lastSpeakId(invoke);
    fire("tts:segment", { id, index: 0, text: "Nice work so far," });
    fire("tts:segment", { id: "the-app-windows-preview", index: 0, text: "Hi, I'm Hodey." });
    fire("tts:segment", { id, index: 1, text: "now click Insert." });
    fire("tts:done", { id, interrupted: false, error: null });
    await speaking;
    fire("tts:segment", { id, index: 2, text: "after the line ended" });
    expect(heard).toEqual([
      { index: 0, text: "Nice work so far," },
      { index: 1, text: "now click Insert." },
    ]);
  });

  it("drops the rest of a line the learner talked over", async () => {
    const { tts, fire, invoke, heard } = listening();
    const controller = new AbortController();
    const speaking = tts.speak(words("A long explanation. With two parts."), controller.signal);
    await settle();
    const id = lastSpeakId(invoke);
    fire("tts:segment", { id, index: 0, text: "A long explanation." });
    controller.abort();
    fire("tts:segment", { id, index: 1, text: "With two parts." });
    await speaking;
    expect(heard).toEqual([{ index: 0, text: "A long explanation." }]);
  });

  it("drops every line's segments once stopped, and follows the next line", async () => {
    const { tts, fire, invoke, heard } = listening();
    const first = tts.speak(words("First line."), new AbortController().signal);
    await settle();
    const stopped = lastSpeakId(invoke);
    await tts.stop();
    fire("tts:segment", { id: stopped, index: 0, text: "First line." });
    fire("tts:done", { id: stopped, interrupted: true, error: null });
    await first;
    const second = tts.speak(words("Second line."), new AbortController().signal);
    await settle();
    const id = lastSpeakId(invoke);
    fire("tts:segment", { id, index: 0, text: "Second line." });
    fire("tts:done", { id, interrupted: false, error: null });
    await second;
    expect(heard).toEqual([{ index: 0, text: "Second line." }]);
  });

  it("keeps following the next line when an earlier line's signal aborts after it finished", async () => {
    const { tts, fire, invoke, heard } = listening();
    const earlier = new AbortController();
    const first = tts.speak(words("First line."), earlier.signal);
    await settle();
    fire("tts:done", { id: lastSpeakId(invoke), interrupted: false, error: null });
    await first;
    const second = tts.speak(words("Second line."), new AbortController().signal);
    await settle();
    earlier.abort();
    const id = lastSpeakId(invoke);
    fire("tts:segment", { id, index: 0, text: "Second line." });
    fire("tts:done", { id, interrupted: false, error: null });
    await second;
    expect(heard).toEqual([{ index: 0, text: "Second line." }]);
    expect(invoke).not.toHaveBeenCalledWith("tts_stop");
  });

  it("drops the segments of a line that failed", async () => {
    const { tts, fire, invoke, heard } = listening();
    const speaking = tts.speak(words("Click Insert."), new AbortController().signal);
    await settle();
    const id = lastSpeakId(invoke);
    fire("tts:done", { id, interrupted: false, error: "The voice couldn't say that." });
    await expect(speaking).rejects.toThrow("couldn't say that");
    fire("tts:segment", { id, index: 0, text: "Click Insert." });
    expect(heard).toEqual([]);
  });

  it("stops reporting once unsubscribed", async () => {
    const { tts, fire, invoke, heard, off } = listening();
    tts.speak(words("Click Insert."), new AbortController().signal).catch(() => undefined);
    await settle();
    off();
    fire("tts:segment", { id: lastSpeakId(invoke), index: 0, text: "Click Insert." });
    expect(heard).toEqual([]);
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

  it("passes on the natural voice's segments while it says a line, and none while a Windows voice speaks", async () => {
    const natural = fakeSegmentedVoice();
    const windows = fake();
    let ready = true;
    const tts = new RoutedTTS(natural.voice, windows, () => ready);
    const heard: SpokenSegment[] = [];
    tts.onSegment((segment) => heard.push(segment));
    const first = tts.speak(words("one"), new AbortController().signal);
    await settle();
    natural.report({ index: 0, text: "one" });
    natural.finish();
    await first;
    ready = false;
    const second = tts.speak(words("two"), new AbortController().signal);
    natural.report({ index: 0, text: "not what's being said" });
    await second;
    expect(windows.said).toEqual(["two"]);
    expect(heard).toEqual([{ index: 0, text: "one" }]);
  });

  it("has no segments when its natural voice can't tell them", () => {
    const tts = new RoutedTTS(fake(), fake(), () => true);
    const off = tts.onSegment(() => undefined);
    expect(off).toBeTypeOf("function");
    off();
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
