import { describe, expect, it, vi } from "vitest";
import { Flag } from "../../lib/flag";
import type { TTSProvider } from "../interfaces";
import { once } from "./native-voice";
import { trackSpeaking } from "./speaking";

/** A voice whose lines finish (or fail) when the test says so. */
class HeldVoice implements TTSProvider {
  readonly lines: Array<{ finish: () => void; fail: (error: Error) => void }> = [];
  stop = vi.fn(async () => undefined);
  healthCheck = vi.fn(async () => true);

  speak(): Promise<void> {
    return new Promise((finish, fail) => {
      this.lines.push({ finish: () => finish(), fail });
    });
  }
}

const say = (tts: TTSProvider, text: string) => tts.speak(once(text), new AbortController().signal);

describe("trackSpeaking", () => {
  it("is on from the moment a line is handed over until it has been said", async () => {
    const voice = new HeldVoice();
    const speaking = new Flag();
    const tts = trackSpeaking(voice, speaking);
    const line = say(tts, "Click the Insert tab.");
    expect(speaking.current()).toBe(true);
    voice.lines[0].finish();
    await line;
    expect(speaking.current()).toBe(false);
  });

  it("stays on while a new line starts before the one it cut off has settled", async () => {
    const voice = new HeldVoice();
    const speaking = new Flag();
    const tts = trackSpeaking(voice, speaking);
    const first = say(tts, "Click the Insert tab.");
    const second = say(tts, "Sure, let me look.");
    voice.lines[0].finish();
    await first;
    expect(speaking.current()).toBe(true);
    voice.lines[1].finish();
    await second;
    expect(speaking.current()).toBe(false);
  });

  it("goes off when the voice fails, and still reports the failure", async () => {
    const voice = new HeldVoice();
    const speaking = new Flag();
    const line = say(trackSpeaking(voice, speaking), "Hello!");
    voice.lines[0].fail(new Error("speaker unplugged"));
    await expect(line).rejects.toThrow("speaker unplugged");
    expect(speaking.current()).toBe(false);
  });

  it("passes stop and health checks through to the voice", async () => {
    const voice = new HeldVoice();
    const tts = trackSpeaking(voice, new Flag());
    await tts.stop();
    expect(voice.stop).toHaveBeenCalledOnce();
    await expect(tts.healthCheck()).resolves.toBe(true);
  });
});
