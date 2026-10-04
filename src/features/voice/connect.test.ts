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
  current: SpeechInputStatus = "idle";
  status(): SpeechInputStatus {
    return this.current;
  }
  unavailableReason() {
    return undefined;
  }
  start = vi.fn(async () => undefined);
  async stop() {}
  wake = new Set<(text: string) => void>();
  onWakeCandidate(handler: (text: string) => void) {
    this.wake.add(handler);
    return () => this.wake.delete(handler);
  }
  overheard(text: string) {
    this.wake.forEach((h) => h(text));
  }
  followUp = vi.fn(async () => undefined);
  setStatus(status: SpeechInputStatus) {
    this.current = status;
    this.statusHandlers.forEach((h) => h(status));
  }
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

function setup(state: HodeState, saying?: string, conversation = true) {
  const speech = new FakeSpeech();
  const dispatched: HodeEvent[] = [];
  const interrupt = vi.fn();
  const doneSpeaking = new Set<() => void>();
  const off = connectVoice({
    speech,
    getState: () => state,
    dispatch: (e) => dispatched.push(e),
    interrupt,
    packs: TASK_PACKS,
    openAllowed: () => false,
    hodeySaying: () => saying,
    onHodeyDoneSpeaking: (listener) => {
      doneSpeaking.add(listener);
      return () => doneSpeaking.delete(listener);
    },
    conversation: () => conversation,
    wakeWords: () => ["Hey Hodes"],
  });
  const hodeyFinishes = () => doneSpeaking.forEach((l) => l());
  return { speech, dispatched, interrupt, off, hodeyFinishes };
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

describe("conversation", () => {
  const guiding = { ...initialState, phase: "guiding" as const, pack: PACK };

  /** One spoken turn: the mic opens, the learner says something, the mic closes. */
  const turn = (speech: FakeSpeech, text?: string) => {
    speech.setStatus("listening");
    if (text) speech.say(text);
    speech.setStatus("idle");
  };

  it("listens for a reply once Hodey has answered", () => {
    const { speech, hodeyFinishes } = setup(guiding);
    turn(speech, "where is the insert tab");
    hodeyFinishes();
    expect(speech.followUp).toHaveBeenCalledOnce();
  });

  it("keeps going turn after turn, and ends when the learner goes quiet", () => {
    const { speech, hodeyFinishes } = setup(guiding);
    turn(speech, "give me a hint");
    hodeyFinishes();
    turn(speech, "say that again");
    hodeyFinishes();
    expect(speech.followUp).toHaveBeenCalledTimes(2);
    turn(speech);
    hodeyFinishes();
    expect(speech.followUp).toHaveBeenCalledTimes(2);
  });

  it("ends when the learner says so, without sending it anywhere", () => {
    const { speech, dispatched, hodeyFinishes } = setup(guiding);
    turn(speech, "thanks, that's all");
    hodeyFinishes();
    expect(dispatched).toEqual([]);
    expect(speech.followUp).not.toHaveBeenCalled();
  });

  it("never opens the mic on its own unless the learner started talking", () => {
    const { speech, hodeyFinishes } = setup(guiding);
    hodeyFinishes();
    expect(speech.followUp).not.toHaveBeenCalled();
  });

  it("waits while Hodey is still working out the answer (its quick 'one sec' isn't the learner's turn)", () => {
    const { speech, hodeyFinishes } = setup({ ...guiding, phase: "reasoning" });
    turn(speech, "what is this");
    hodeyFinishes();
    expect(speech.followUp).not.toHaveBeenCalled();
  });

  it("respects the setting", () => {
    const { speech, hodeyFinishes } = setup(guiding, undefined, false);
    turn(speech, "give me a hint");
    hodeyFinishes();
    expect(speech.followUp).not.toHaveBeenCalled();
  });

  describe("hands-free", () => {
    const guiding: HodeState = { ...initialState, phase: "guiding", pack: PACK };

    it("acts on what follows a wake word", () => {
      const { speech, dispatched } = setup(guiding);
      speech.overheard("Hey Hodey, give me a hint");
      speech.overheard("Hey Hodes, give me a hint");
      expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }, { type: "HINT_REQUESTED" }]);
    });

    it("listens for the request after a bare wake word", () => {
      const { speech, dispatched } = setup(guiding);
      speech.overheard("Hey Hodey.");
      expect(speech.start).toHaveBeenCalledOnce();
      expect(dispatched).toEqual([]);
    });

    it("ignores room speech, Hodey's own voice, and wake words during an active turn", () => {
      const { speech, dispatched } = setup(guiding);
      speech.overheard("I think it's lunch time");
      expect(dispatched).toEqual([]);
      const talking = setup(guiding, "Hey Hodey can help with that.");
      talking.speech.overheard("Hey Hodey can help with that.");
      expect(talking.dispatched).toEqual([]);
      speech.current = "listening";
      speech.overheard("Hey Hodey, give me a hint");
      expect(dispatched).toEqual([]);
      expect(speech.start).not.toHaveBeenCalled();
    });
  });
});
