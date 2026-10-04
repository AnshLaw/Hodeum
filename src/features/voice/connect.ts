import type { TaskPack } from "../../lib/types";
import type { SpeechInput, SpeechInputStatus } from "../../providers/speech/speech-input";
import type { HodeEvent, HodePhase, HodeState } from "../hode/model";
import { routeUtterance, wakeRest } from "./route";

const BUSY_PHASES: HodePhase[] = ["observing", "reasoning"];

/** Share of heard words that must appear in Hodey's own sentence for it to count as echo. */
const ECHO_OVERLAP = 0.7;
/** Words of the learner's own (not Hodey's) heard over Hodey before it stops: one misheard echo word isn't enough. */
const BARGE_IN_WORDS = 2;
/** In a conversation, how long Hodey waits for a reply after answering before it stops listening. */
export const CONVERSATION_PATIENCE_MS = 6000;

export interface VoiceDeps {
  speech: SpeechInput;
  getState: () => HodeState;
  dispatch: (event: HodeEvent) => void;
  /** Stops Hodey's speech immediately (barge-in). */
  interrupt: () => void;
  packs: TaskPack[];
  openAllowed: () => boolean;
  /** What Hodey is saying now (or just said), so its own voice through the speakers isn't obeyed. */
  hodeySaying: () => string | undefined;
  /** Hodey finished a sentence (not cut off): the learner's turn in a conversation. */
  onHodeyDoneSpeaking: (listener: () => void) => () => void;
  /** Settings: keep talking back and forth after Hodey answers. */
  conversation: () => boolean;
  /** Settings: extra names the learner calls Hodey. */
  wakeWords?: () => string[];
}

/** Ways to close the conversation; they end it without being treated as a command or question. */
const CLOSERS = /^(?:(?:ok(?:ay)?|thanks|thank you)[ ,]*)?(?:that'?s all|that is all|bye|goodbye|stop listening|no thanks|nothing|never ?mind|i'?m good|all good)[.!]?$/i;

/** Words, keeping Devanagari vowel signs (marks) inside their words. */
const wordsOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);

/** Whether the mic most likely picked up Hodey's own speech rather than the learner. */
export function isEcho(heard: string, said: string): boolean {
  const heardWords = wordsOf(heard);
  if (heardWords.length === 0) return false;
  const saidWords = new Set(wordsOf(said));
  const shared = heardWords.filter((w) => saidWords.has(w)).length;
  return shared / heardWords.length >= ECHO_OVERLAP;
}

/** How many heard words aren't in Hodey's sentence: the learner's own words. */
function ownWords(heard: string, said: string): number {
  const saidWords = new Set(wordsOf(said));
  return wordsOf(heard).filter((w) => !saidWords.has(w)).length;
}

/** What the learner said over Hodey, without Hodey's words the mic caught first. */
export function stripEcho(heard: string, said: string): string {
  const saidWords = new Set(wordsOf(said));
  const tokens = heard.trim().split(/\s+/);
  const first = tokens.findIndex((token) => wordsOf(token).some((w) => !saidWords.has(w)));
  return first < 0 ? "" : tokens.slice(first).join(" ");
}

/**
 * Wires local speech to the Hode, as a conversation like a voice chat: once the learner talks, the mic stays open
 * while Hodey answers, so they can cut in at any moment. Without echo cancellation the mic also hears Hodey, so
 * Hodey stops only for words that aren't its own, and its words are stripped from what the learner said.
 */
export function connectVoice(deps: VoiceDeps): () => void {
  const conversation = new Conversation(deps);
  const offs = [
    deps.speech.onStatus((status) => conversation.onStatus(status)),
    deps.speech.onSpeechStart(() => conversation.onSpeechStart()),
    deps.speech.onTranscript((text, final) => conversation.onTranscript(text, final)),
    deps.speech.onWakeCandidate?.((text, final) => conversation.onWakeCandidate(text, final)) ?? (() => undefined),
    deps.onHodeyDoneSpeaking(() => conversation.onHodeyDone()),
  ];
  return () => {
    conversation.dispose();
    offs.forEach((off) => off());
  };
}

class Conversation {
  /** The learner is talking with Hodey: keep the mic open between turns. */
  private conversing = false;
  /** The open-mic conversation session was requested and hasn't started yet. */
  private opening = false;
  /** The open-mic conversation session is running. */
  private open = false;
  private quietTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: VoiceDeps) {}

  onStatus(status: SpeechInputStatus): void {
    if (status === "listening") {
      // Tapping the mic means "I want to talk": Hodey stops at once. The conversation's own mic doesn't.
      if (this.opening) this.open = true;
      else this.deps.interrupt();
      this.opening = false;
      return;
    }
    if (this.open) this.end(false);
    else if (this.conversing) this.openMic();
  }

  onSpeechStart(): void {
    this.clearQuietTimer();
    if (!this.deps.hodeySaying()) this.deps.interrupt();
  }

  onTranscript(text: string, final: boolean): void {
    const saying = this.deps.hodeySaying();
    if (saying && isEcho(text, saying)) {
      if (final && this.open) this.armQuietTimer();
      return;
    }
    if (!final) {
      if (saying && ownWords(text, saying) >= BARGE_IN_WORDS) this.deps.interrupt();
      return;
    }
    const said = saying ? stripEcho(text, saying) : text;
    if (CLOSERS.test(said.trim())) return this.end(true);
    this.conversing = this.deps.conversation();
    routeUtterance(this.deps.getState(), said, this.deps.packs, this.deps.openAllowed(), this.deps.wakeWords?.() ?? []).forEach(this.deps.dispatch);
    if (this.conversing && this.deps.speech.status() === "idle") this.openMic();
  }

  /** Hands-free: overheard speech. Only a wake word counts; heard over Hodey, it stops Hodey at once. */
  onWakeCandidate(text: string, final: boolean): void {
    if (this.deps.speech.status() !== "idle") return;
    const saying = this.deps.hodeySaying();
    if (saying && isEcho(text, saying)) return;
    const rest = wakeRest(text, this.deps.wakeWords?.() ?? []);
    if (rest === undefined) return;
    if (saying) this.deps.interrupt();
    if (!final) return;
    if (!rest) {
      this.deps.speech.start().catch((error: unknown) => console.error("Couldn't listen after the wake word", error));
      return;
    }
    this.conversing = this.deps.conversation();
    routeUtterance(this.deps.getState(), rest, this.deps.packs, this.deps.openAllowed()).forEach(this.deps.dispatch);
    if (this.conversing) this.openMic();
  }

  onHodeyDone(): void {
    // While Hodey is still looking or thinking, its "one sec" isn't the learner's turn yet.
    if (this.open && !BUSY_PHASES.includes(this.deps.getState().phase)) this.armQuietTimer();
  }

  dispose(): void {
    this.clearQuietTimer();
  }

  private openMic(): void {
    if (this.opening || this.open || !this.deps.speech.converse) return;
    this.opening = true;
    this.deps.speech.converse().catch((error: unknown) => {
      this.opening = false;
      this.conversing = false;
      console.error("Couldn't keep listening for the conversation", error);
    });
  }

  /** The conversation is over: the learner said so, went quiet, or the mic closed. */
  private end(stopMic: boolean): void {
    const wasOpen = this.open;
    this.conversing = false;
    this.open = false;
    this.clearQuietTimer();
    if (stopMic && wasOpen) this.deps.speech.stop().catch((error: unknown) => console.error("Couldn't stop listening", error));
  }

  private armQuietTimer(): void {
    this.clearQuietTimer();
    this.quietTimer = setTimeout(() => {
      this.quietTimer = undefined;
      if (!BUSY_PHASES.includes(this.deps.getState().phase)) this.end(true);
    }, CONVERSATION_PATIENCE_MS);
  }

  private clearQuietTimer(): void {
    clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
  }
}

/** The learner's words for display: Hodey's own voice in the open mic is left out. */
export function withoutEcho(speech: SpeechInput, hodeySaying: () => string | undefined): SpeechInput {
  const view: SpeechInput = Object.create(speech);
  view.onTranscript = (handler) =>
    speech.onTranscript((text, final) => {
      const saying = hodeySaying();
      if (saying && isEcho(text, saying)) return;
      const said = saying ? stripEcho(text, saying) : text;
      if (said) handler(said, final);
    });
  return view;
}
