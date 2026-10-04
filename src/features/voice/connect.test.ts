import { describe, expect, it, vi } from "vitest";
import { initialState, type HodeEvent, type HodeState } from "../hode/model";
import { PACK } from "../hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import type { SpeechInput, SpeechInputStatus } from "../../providers/speech/speech-input";
import { CONVERSATION_PATIENCE_MS, connectVoice, isEcho, stripEcho } from "./connect";

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
  stop = vi.fn(async () => undefined);
  wake = new Set<(text: string, final: boolean) => void>();
  onWakeCandidate(handler: (text: string, final: boolean) => void) {
    this.wake.add(handler);
    return () => this.wake.delete(handler);
  }
  overheard(text: string, final = true) {
    this.wake.forEach((h) => h(text, final));
  }
  converse = vi.fn(async () => undefined);
  warmMic = vi.fn(async () => undefined);
  /** Windows' echo cancellation is on for the open mic. */
  aec = false;
  echoCancelled() {
    return this.aec;
  }
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
  const hodeEvents = new Set<(event: HodeEvent) => void>();
  /** Each change to whether a conversation is open, as the notch hears it. */
  const conversationOpen: boolean[] = [];
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
    onHodeEvent: (listener) => {
      hodeEvents.add(listener);
      return () => hodeEvents.delete(listener);
    },
    onConversation: (open) => conversationOpen.push(open),
  });
  const hodeyFinishes = () => doneSpeaking.forEach((l) => l());
  const hode = (event: HodeEvent) => hodeEvents.forEach((l) => l(event));
  return { speech, dispatched, interrupt, off, hodeyFinishes, hode, conversationOpen };
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

  it("strips Hodey's words from the start of what the learner said over it", () => {
    expect(stripEcho("click the insert tab wait what is this", SAID)).toBe("wait what is this");
    expect(stripEcho("what is this", SAID)).toBe("what is this");
  });

  it("drops a final transcript that just repeats Hodey", () => {
    const { speech, dispatched } = setup({ ...initialState, phase: "guiding", pack: PACK }, SAID);
    speech.say("click the insert tab at the top");
    expect(dispatched).toEqual([]);
  });
});

describe("conversation", () => {
  const guiding = { ...initialState, phase: "guiding" as const, pack: PACK };

  /** The learner taps to talk and says something; the tap session closes. */
  const tap = (speech: FakeSpeech, text: string) => {
    speech.setStatus("listening");
    speech.say(text);
    speech.setStatus("idle");
  };

  it("keeps the mic open as a conversation once the learner has spoken", () => {
    const { speech } = setup(guiding);
    tap(speech, "where is the insert tab");
    expect(speech.converse).toHaveBeenCalledOnce();
  });

  it("opening the conversation doesn't cut off what Hodey is saying", () => {
    const { speech, interrupt } = setup(guiding, "Let me look.");
    tap(speech, "where is the insert tab");
    interrupt.mockClear();
    speech.setStatus("listening");
    expect(interrupt).not.toHaveBeenCalled();
  });

  it("routes each reply in the same open session", () => {
    const { speech, dispatched } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    speech.say("say that again");
    expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }, { type: "REPEAT" }]);
    expect(speech.converse).toHaveBeenCalledOnce();
  });

  it("ends when the learner stays quiet after Hodey answers", () => {
    vi.useFakeTimers();
    const { speech, hodeyFinishes } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    hodeyFinishes();
    vi.advanceTimersByTime(CONVERSATION_PATIENCE_MS + 1);
    expect(speech.stop).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("keeps waiting while the learner is talking", () => {
    vi.useFakeTimers();
    const { speech, hodeyFinishes } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    hodeyFinishes();
    vi.advanceTimersByTime(CONVERSATION_PATIENCE_MS - 1000);
    speech.speechStart.forEach((h) => h());
    vi.advanceTimersByTime(2000);
    expect(speech.stop).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("ends when the learner says so, without sending it anywhere", () => {
    const { speech, dispatched } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    speech.say("thanks, that's all");
    expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(speech.stop).toHaveBeenCalledOnce();
  });

  it("ends when the learner closes the answer or the Hode", () => {
    const { speech, hode } = setup(guiding);
    tap(speech, "what is this");
    speech.setStatus("listening");
    hode({ type: "DISMISS" });
    expect(speech.stop).toHaveBeenCalledOnce();
  });

  it("ends on a bare thanks", () => {
    const { speech, dispatched } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    speech.say("thank you");
    expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(speech.stop).toHaveBeenCalledOnce();
  });

  it("stops waiting once a noise is heard and nothing comes of it", () => {
    vi.useFakeTimers();
    const { speech } = setup(guiding);
    tap(speech, "give me a hint");
    speech.setStatus("listening");
    speech.speechStart.forEach((h) => h());
    speech.say("yeah");
    vi.advanceTimersByTime(CONVERSATION_PATIENCE_MS + 1);
    expect(speech.stop).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("doesn't wait out a quiet turn while Hodey is still working out the answer", () => {
    vi.useFakeTimers();
    const { speech, hodeyFinishes } = setup({ ...guiding, phase: "reasoning" });
    tap(speech, "what is this");
    hodeyFinishes();
    vi.advanceTimersByTime(CONVERSATION_PATIENCE_MS + 1);
    expect(speech.stop).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("respects the setting", () => {
    const { speech } = setup(guiding, undefined, false);
    tap(speech, "give me a hint");
    expect(speech.converse).not.toHaveBeenCalled();
  });

  describe("telling the notch it's open", () => {
    it("is open from the learner's first words, across the mic reopening, until they go quiet", () => {
      vi.useFakeTimers();
      const { speech, hodeyFinishes, conversationOpen } = setup(guiding);
      speech.setStatus("listening");
      expect(conversationOpen).toEqual([]);
      speech.say("give me a hint");
      expect(conversationOpen).toEqual([true]);
      // The tap's mic closes and the conversation's opens: no gap in between.
      speech.setStatus("idle");
      speech.setStatus("listening");
      hodeyFinishes();
      expect(conversationOpen).toEqual([true]);
      vi.advanceTimersByTime(CONVERSATION_PATIENCE_MS + 1);
      expect(conversationOpen).toEqual([true, false]);
      vi.useRealTimers();
    });

    it("closes with the answer or the Hode, and when the conversation's mic closes", () => {
      const dismissed = setup(guiding);
      tap(dismissed.speech, "what is this");
      dismissed.speech.setStatus("listening");
      dismissed.hode({ type: "DISMISS" });
      expect(dismissed.conversationOpen).toEqual([true, false]);
      const micClosed = setup(guiding);
      tap(micClosed.speech, "give me a hint");
      micClosed.speech.setStatus("listening");
      micClosed.speech.setStatus("idle");
      expect(micClosed.conversationOpen).toEqual([true, false]);
    });

    it("closes when the conversation's mic can't open", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const { speech, conversationOpen } = setup(guiding);
      speech.converse.mockRejectedValueOnce(new Error("microphone busy"));
      tap(speech, "give me a hint");
      await vi.waitFor(() => expect(conversationOpen).toEqual([true, false]));
      expect(errorLog).toHaveBeenCalledWith("Couldn't keep listening for the conversation", expect.any(Error));
      errorLog.mockRestore();
    });

    it("opens after a wake word, and never with conversations off or for a thank-you", () => {
      const woken = setup(guiding);
      woken.speech.overheard("Hey Hodey, give me a hint");
      expect(woken.conversationOpen).toEqual([true]);
      const off = setup(guiding, undefined, false);
      tap(off.speech, "give me a hint");
      expect(off.conversationOpen).toEqual([]);
      const thanks = setup(guiding);
      tap(thanks.speech, "thanks");
      expect(thanks.conversationOpen).toEqual([]);
    });

    it("isn't open where the mic can't hold a conversation", () => {
      const { speech, conversationOpen } = setup(guiding);
      Object.assign(speech, { converse: undefined });
      tap(speech, "give me a hint");
      expect(conversationOpen).toEqual([]);
    });
  });

  describe("barge-in", () => {
    const SAID = "Click the Insert tab at the top. I've highlighted it.";

    it("stops Hodey mid-sentence when the learner talks over it, and hears the question", () => {
      const { speech, interrupt, dispatched } = setup(guiding, SAID);
      tap(speech, "give me a hint");
      speech.setStatus("listening");
      interrupt.mockClear();
      speech.say("click the insert tab wait", false);
      expect(interrupt).not.toHaveBeenCalled();
      speech.say("click the insert tab wait what is a pivot", false);
      expect(interrupt).toHaveBeenCalledOnce();
      speech.say("click the insert tab wait what is a pivot table");
      expect(dispatched.at(-1)).toEqual({ type: "VOICE_QUESTION", question: "wait what is a pivot table" });
    });

    it("ignores its own voice in the open mic", () => {
      const { speech, interrupt, dispatched } = setup(guiding, SAID);
      tap(speech, "give me a hint");
      speech.setStatus("listening");
      interrupt.mockClear();
      speech.say("click the insert tab at the top", false);
      speech.say("click the insert tab at the top");
      expect(interrupt).not.toHaveBeenCalled();
      expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
    });
  });

  describe("echo of Hodey's voice, by how the mic is listening", () => {
    const ASKED = "Which tab would you use to add something new?";
    const startTalking = (speech: FakeSpeech) => speech.speechStart.forEach((h) => h());

    it("hears an answer that repeats Hodey's words when Windows cancels the echo", () => {
      const { speech, dispatched } = setup(guiding, ASKED);
      tap(speech, "give me a hint");
      speech.aec = true;
      speech.setStatus("listening");
      startTalking(speech);
      speech.say("new tab");
      expect(dispatched.length).toBeGreaterThan(1);
      expect(dispatched.at(-1)).not.toEqual({ type: "HINT_REQUESTED" });
    });

    it("hears an answer that repeats Hodey's words on a tap, which stopped Hodey first", () => {
      const { speech, dispatched } = setup(guiding, ASKED);
      speech.setStatus("listening");
      startTalking(speech);
      speech.say("new tab");
      expect(dispatched).not.toEqual([]);
    });

    it("drops the same words on an open mic without echo cancellation", () => {
      const { speech, dispatched } = setup(guiding, ASKED);
      tap(speech, "give me a hint");
      speech.setStatus("listening");
      speech.say("new tab");
      expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
    });

    it("drops speech begun over Hodey without echo cancellation unless the learner's own words break through", () => {
      const { speech, dispatched } = setup(guiding, ASKED);
      tap(speech, "give me a hint");
      speech.setStatus("listening");
      startTalking(speech);
      speech.say("you lose");
      expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
      startTalking(speech);
      speech.say("wait what", false);
      speech.say("wait what is this");
      expect(dispatched.at(-1)).toEqual({ type: "VOICE_QUESTION", question: "wait what is this" });
    });

    it("starts warming the echo-cancelled mic when a tap will lead into a conversation", () => {
      const { speech } = setup(guiding);
      speech.setStatus("listening");
      expect(speech.warmMic).toHaveBeenCalledOnce();
      const solo = setup(guiding, undefined, false);
      solo.speech.setStatus("listening");
      expect(solo.speech.warmMic).not.toHaveBeenCalled();
    });

    it("doesn't warm the mic for the conversation's own session", () => {
      const { speech } = setup(guiding);
      tap(speech, "give me a hint");
      speech.warmMic.mockClear();
      speech.setStatus("listening");
      expect(speech.warmMic).not.toHaveBeenCalled();
    });
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

    it("interrupts Hodey as soon as the wake word is heard over it", () => {
      const { speech, interrupt, dispatched } = setup(guiding, "Click the Insert tab at the top.");
      speech.overheard("Hey Hodey", false);
      expect(interrupt).toHaveBeenCalledOnce();
      speech.overheard("Hey Hodey, give me a hint");
      expect(dispatched).toEqual([{ type: "HINT_REQUESTED" }]);
    });

    it("carries on as a conversation after a wake word", () => {
      const { speech } = setup(guiding);
      speech.overheard("Hey Hodey, give me a hint");
      expect(speech.converse).toHaveBeenCalledOnce();
    });

    it("ignores room speech, Hodey's own voice, and wake words during an active turn", () => {
      const { speech, dispatched } = setup(guiding);
      speech.overheard("I think it's lunch time");
      expect(dispatched).toEqual([]);
      const talking = setup(guiding, "Hey Hodey can help with that.");
      talking.speech.overheard("Hey Hodey can help", false);
      talking.speech.overheard("Hey Hodey can help with that.");
      expect(talking.dispatched).toEqual([]);
      expect(talking.interrupt).not.toHaveBeenCalled();
      speech.current = "listening";
      speech.overheard("Hey Hodey, give me a hint");
      expect(dispatched).toEqual([]);
      expect(speech.start).not.toHaveBeenCalled();
    });
  });
});
