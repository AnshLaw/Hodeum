import { describe, expect, it, vi } from "vitest";
import { initialState, type HodeEvent, type HodeState } from "../hode/model";
import { PACK } from "../hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import type { SpeechInput, SpeechInputStatus } from "../../providers/speech/speech-input";
import { connectVoice, isEcho } from "./connect";

class FakeSpeech implements SpeechInput {
  statusHandlers = new Set<(status: SpeechInputStatus) => void>();
  transcript = new Set<(text: string, final: boolean) => void>();
  speechStart = new Set<() => void>();
  status(): SpeechInputStatus {
    return "listening";
  }
  unavailableReason() {
    return undefined;
  }
  async start() {}
  async stop() {}
  onStatus(handler: (status: SpeechInputStatus) => void) {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }
  onTranscript(handler: (text: string, final: boolean) => void) {
    this.transcript.add(handler);
    return () => this.transcript.delete(handler);
  }
  onSpeechStart(handler: () => void) {
    this.speechStart.add(handler);
    return () => this.speechStart.delete(handler);
  }
  say(text: string, final = true) {
    this.transcript.forEach((h) => h(text, final));
  }
}

function setup(state: HodeState, saying?: string) {
  const speech = new FakeSpeech();
  const dispatched: HodeEvent[] = [];
  const interrupt = vi.fn();
  const off = connectVoice({ speech, getState: () => state, dispatch: (e) => dispatched.push(e), interrupt, packs: TASK_PACKS, openAllowed: () => false, hodeySaying: () => saying });
  return { speech, dispatched, interrupt, off };
}

describe("connectVoice", () => {
  it("stops Hodey talking when the learner taps to talk", () => {
    const { speech, interrupt } = setup(initialState, "Click Insert.");
    speech.statusHandlers.forEach((h) => h("listening"));
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("stops Hodey talking the moment the learner starts speaking", () => {
    const { speech, interrupt } = setup(initialState);
    speech.speechStart.forEach((h) => h());
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("routes only final transcripts", () => {
    const { speech, dispatched } = setup({ ...initialState, phase: "guiding", pack: PACK });
    speech.say("give me a", false);
    expect(dispatched).toEqual([]);
    speech.say("give me a hint");
    expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
  });

  it("stops listening when disconnected", () => {
    const { speech, dispatched, off } = setup(initialState);
    off();
    speech.say("what is this?");
    expect(dispatched).toEqual([]);
  });
});

describe("echo of Hodey's own voice", () => {
  const SAID = "Click the Insert tab at the top. I've highlighted it.";

  it("recognises Hodey's words coming back through the mic", () => {
    expect(isEcho("click the insert tab at the top", SAID)).toBe(true);
    expect(isEcho("give me a hint", SAID)).toBe(false);
    expect(isEcho("wait stop", SAID)).toBe(false);
  });

  it("only interrupts once the words aren't Hodey's own", () => {
    const { speech, interrupt } = setup({ ...initialState, phase: "guiding", pack: PACK }, SAID);
    speech.speechStart.forEach((h) => h());
    speech.say("click the insert", false);
    expect(interrupt).not.toHaveBeenCalled();
    speech.say("hold on", false);
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("drops a final transcript that just repeats Hodey", () => {
    const { speech, dispatched } = setup({ ...initialState, phase: "guiding", pack: PACK }, SAID);
    speech.say("click the insert tab at the top");
    expect(dispatched).toEqual([]);
  });
});
