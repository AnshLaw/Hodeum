import { describe, expect, it, vi } from "vitest";
import type { TTSProvider } from "../interfaces";
import { ActivityTracker } from "../../lib/activity";
import { CloudFirstTTS, ElevenLabsTTSProvider, type VoicePolicy } from "./elevenlabs-tts";

async function* chunks(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) yield part;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeLocal() {
  const said: string[] = [];
  const local: TTSProvider = {
    speak: vi.fn(async (text: AsyncIterable<string>) => {
      let all = "";
      for await (const part of text) all += part;
      said.push(all);
    }),
    stop: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => true),
  };
  return { local, said };
}

function fakePolicy(allowed = true): VoicePolicy & { reportFailure: ReturnType<typeof vi.fn>; reportSuccess: ReturnType<typeof vi.fn> } {
  return { allowed: vi.fn(() => allowed), reportFailure: vi.fn(), reportSuccess: vi.fn() };
}

type Invoke = ConstructorParameters<typeof ElevenLabsTTSProvider>[0];
const elevenLabs = (invoke: unknown) => new ElevenLabsTTSProvider(invoke as Invoke);

describe("ElevenLabsTTSProvider", () => {
  it("sends the whole utterance, chunks in order, with the learner's speed", async () => {
    const invoke = vi.fn(async () => false);
    const voice = elevenLabs(invoke);
    voice.rate = 1.1;
    await voice.speak(chunks("Click the ", "Insert tab", "."), new AbortController().signal);
    expect(invoke).toHaveBeenCalledWith("elevenlabs_speak", { text: "Click the Insert tab.", speed: 1.1 });
  });

  it("sends the same Hindi text the local Hindi voice would say", async () => {
    const invoke = vi.fn(async () => false);
    await elevenLabs(invoke).speak(chunks("अब Insert टैब पर क्लिक कीजिए।"), new AbortController().signal);
    expect(invoke).toHaveBeenCalledWith("elevenlabs_speak", { text: "अब इंसर्ट टैब पर क्लिक कीजिए।", speed: 1 });
  });

  it("sends nothing once the utterance is aborted", async () => {
    const invoke = vi.fn(async () => false);
    const controller = new AbortController();
    async function* interrupted(): AsyncGenerator<string> {
      yield "Click the ";
      controller.abort();
      yield "Insert tab.";
    }
    await elevenLabs(invoke).speak(interrupted(), controller.signal);
    expect(invoke).not.toHaveBeenCalledWith("elevenlabs_speak", expect.anything());
  });

  it("stop aborts the stream: barge-in silences it through the shared stop and returns at once", async () => {
    const playing = deferred<boolean>();
    const invoke = vi.fn(async (command: string) => (command === "elevenlabs_speak" ? playing.promise : undefined));
    const controller = new AbortController();
    const speaking = elevenLabs(invoke).speak(chunks("A long explanation."), controller.signal);
    await settle();
    controller.abort();
    await speaking;
    expect(invoke).toHaveBeenLastCalledWith("tts_stop");
    playing.resolve(true);
  });

  it("rejects when the stream fails, so the caller can fall back", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("ElevenLabs answered 401");
    });
    await expect(elevenLabs(invoke).speak(chunks("Hi."), new AbortController().signal)).rejects.toThrow("401");
  });

  it("does not stop later speech when its signal aborts after it finished", async () => {
    const invoke = vi.fn(async () => false);
    const controller = new AbortController();
    await elevenLabs(invoke).speak(chunks("Done."), controller.signal);
    controller.abort();
    expect(invoke).not.toHaveBeenCalledWith("tts_stop");
  });
});

describe("CloudFirstTTS", () => {
  function setup(allowed = true, cloudSpeak?: TTSProvider["speak"], shareable: (text: string) => boolean = () => true) {
    const { local, said } = fakeLocal();
    const cloud = { multilingual: true, speak: vi.fn(cloudSpeak ?? (async () => undefined)), stop: vi.fn(async () => undefined), healthCheck: vi.fn(async () => true) };
    const policy = fakePolicy(allowed);
    const activity = new ActivityTracker();
    const tts = new CloudFirstTTS({ cloud, local, policy, activity, shareable });
    return { tts, cloud, local, said, policy, activity };
  }

  it("speaks with ElevenLabs first when the policy allows it", async () => {
    const { tts, cloud, local, policy } = setup();
    await tts.speak(chunks("Click ", "Insert."), new AbortController().signal);
    expect(cloud.speak).toHaveBeenCalledOnce();
    expect(local.speak).not.toHaveBeenCalled();
    expect(policy.reportSuccess).toHaveBeenCalledWith("elevenlabs");
  });

  it("uses the local voice when the policy disallows ElevenLabs", async () => {
    const { tts, cloud, said, policy } = setup(false);
    await tts.speak(chunks("Click Insert."), new AbortController().signal);
    expect(cloud.speak).not.toHaveBeenCalled();
    expect(said).toEqual(["Click Insert."]);
    expect(policy.allowed).toHaveBeenCalledWith("elevenlabs");
  });

  it("keeps lines that may quote the screen (answers, open goals) on the local voice", async () => {
    const { tts, cloud, said } = setup(true, undefined, () => false);
    await tts.speak(chunks("That cell says 90,000."), new AbortController().signal);
    expect(cloud.speak).not.toHaveBeenCalled();
    expect(said).toEqual(["That cell says 90,000."]);
  });

  it("says the same utterance locally when ElevenLabs fails, and starts the cooldown", async () => {
    const { tts, said, policy } = setup(true, async () => {
      throw new Error("network down");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await tts.speak(chunks("Click ", "Insert."), new AbortController().signal);
    expect(said).toEqual(["Click Insert."]);
    expect(policy.reportFailure).toHaveBeenCalledWith("elevenlabs");
    expect(policy.reportSuccess).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("doesn't fall back or blame ElevenLabs when the learner interrupted", async () => {
    const controller = new AbortController();
    const { tts, local, policy } = setup(true, async () => {
      controller.abort();
      throw new Error("cancelled");
    });
    await tts.speak(chunks("Click Insert."), controller.signal);
    expect(local.speak).not.toHaveBeenCalled();
    expect(policy.reportFailure).not.toHaveBeenCalled();
  });

  it("keeps Hindi on ElevenLabs only when its voice is multilingual", async () => {
    const multi = setup();
    await multi.tts.speak(chunks("इन्सर्ट टैब पर क्लिक कीजिए।"), new AbortController().signal);
    expect(multi.cloud.speak).toHaveBeenCalledOnce();
    const english = setup();
    english.cloud.multilingual = false;
    await english.tts.speak(chunks("इन्सर्ट टैब पर क्लिक कीजिए।"), new AbortController().signal);
    expect(english.cloud.speak).not.toHaveBeenCalled();
    expect(english.said).toEqual(["इन्सर्ट टैब पर क्लिक कीजिए।"]);
  });

  it("lights the cloud dot while ElevenLabs streams", async () => {
    const playing = deferred<void>();
    const { tts, activity } = setup(true, () => playing.promise);
    const speaking = tts.speak(chunks("Hi."), new AbortController().signal);
    await settle();
    expect(activity.current().cloud).toBe(true);
    playing.resolve();
    await speaking;
  });

  it("stops both voices", async () => {
    const { tts, cloud, local } = setup();
    await tts.stop();
    expect(cloud.stop).toHaveBeenCalledOnce();
    expect(local.stop).toHaveBeenCalledOnce();
  });

  it("is healthy when either voice is", async () => {
    const { tts, cloud } = setup();
    cloud.healthCheck.mockResolvedValue(false);
    expect(await tts.healthCheck()).toBe(true);
  });
});
