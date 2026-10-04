import type { InstalledApp, TaskPack } from "../../lib/types";
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
/** While the learner is talking: long enough for the longest utterance, so noise that never becomes words can't hold the mic open. */
const SPEAKING_PATIENCE_MS = 25_000;

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
  /** Everything the learner says to Hodey, so Auto language can follow them (commands included). */
  heard?: (text: string) => void;
  /** Every Hode event, from any source: closing an answer or the Hode (by voice, button or timer) ends the conversation. */
  onHodeEvent?: (listener: (event: HodeEvent) => void) => () => void;
  /** The PC's installed apps, so "open Excel" opens it. */
  apps?: () => InstalledApp[];
  /** Whether the local vision model is still loading, so a spoken goal it can't plan yet says so. */
  visionStarting?: () => boolean;
}

const ENDS_CONVERSATION = new Set<HodeEvent["type"]>(["DISMISS", "END_HODE"]);

/** Ways to close the conversation; they end it without being treated as a command or question. */
const CLOSERS = /^(?:ok(?:ay)?[ ,]*)?(?:thanks|thank you)(?: so much| a lot)?[.!]?$|^(?:(?:ok(?:ay)?|thanks|thank you)[ ,]*)?(?:that'?s all|that is all|bye|goodbye|stop listening|no thanks|nothing|never ?mind|i'?m good|all good)[.!]?$|^(?:(?:ठीक है|ओके|धन्यवाद|शुक्रिया)[ ,]*)?(?:बस|बस इतना ही|बस इतना|धन्यवाद|शुक्रिया|थैंक यू|कुछ नहीं|बाय)[।.!]?$|^(?:(?:theek hai|thik hai|ok)[ ,]*)?(?:bas|bas itna hi|bas itna|shukriya|dhanyavaad|dhanyavad|kuch nahi)[.!]?$/iu;

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

/** Whether to treat what the mic hears as possibly Hodey's own voice. */
function mayHearHodey(speech: SpeechInput, session: Session): boolean {
  // Windows removes Hodey's voice from an echo-cancelled mic; a tap or hold stops Hodey before listening.
  return session !== "tap" && speech.echoCancelled?.() !== true;
}

/** Which listening session is running: a tap or held key (Hodey stopped first), or the conversation's open mic. */
type Session = "none" | "tap" | "conversation";

/**
 * Wires local speech to the Hode, as a conversation like a voice chat: once the learner talks, the mic stays open
 * while Hodey answers, so they can cut in at any moment. Without echo cancellation the mic also hears Hodey, so
 * Hodey stops only for words that aren't its own, its words are stripped from what the learner said, and speech
 * that began while Hodey talked counts only once the learner's own words break through.
 */
export function connectVoice(deps: VoiceDeps): () => void {
  const conversation = new Conversation(deps);
  const offs = [
    deps.speech.onStatus((status) => conversation.onStatus(status)),
    deps.speech.onSpeechStart(() => conversation.onSpeechStart()),
    deps.speech.onTranscript((text, final) => conversation.onTranscript(text, final)),
    deps.speech.onWakeCandidate?.((text, final) => conversation.onWakeCandidate(text, final)) ?? (() => undefined),
    deps.onHodeyDoneSpeaking(() => conversation.onHodeyDone()),
    deps.onHodeEvent?.((event) => {
      if (ENDS_CONVERSATION.has(event.type)) conversation.close();
    }) ?? (() => undefined),
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
  private session: Session = "none";
  /** The utterance being heard began while Hodey was talking. */
  private overHodey = false;
  /** ...and the learner's own words have since broken through (barge-in confirmed). */
  private bargedIn = false;

  constructor(private readonly deps: VoiceDeps) {}

  onStatus(status: SpeechInputStatus): void {
    if (status === "listening") {
      // Tapping the mic means "I want to talk": Hodey stops at once. The conversation's own mic doesn't.
      if (this.opening) this.open = true;
      else this.onTap();
      this.session = this.opening ? "conversation" : "tap";
      this.opening = false;
      return;
    }
    this.session = "none";
    if (this.open) this.end(false);
    else if (this.conversing) this.openMic();
  }

  private onTap(): void {
    this.deps.interrupt();
    // A conversation usually follows: its echo-cancelled mic opens while the learner is still talking.
    if (this.deps.conversation()) this.deps.speech.warmMic?.().catch((error: unknown) => console.error("Couldn't warm up the microphone", error));
  }

  onSpeechStart(): void {
    if (this.open) this.armQuietTimer(SPEAKING_PATIENCE_MS);
    this.overHodey = this.deps.hodeySaying() !== undefined;
    this.bargedIn = false;
    if (!this.overHodey) this.deps.interrupt();
  }

  onTranscript(text: string, final: boolean): void {
    const saying = this.deps.hodeySaying();
    const echo = saying !== undefined && mayHearHodey(this.deps.speech, this.session) ? saying : undefined;
    if (echo !== undefined && isEcho(text, echo)) {
      if (final && this.open) this.armQuietTimer();
      return;
    }
    if (!final) {
      if (saying && ownWords(text, saying) >= BARGE_IN_WORDS) {
        this.bargedIn = true;
        this.deps.interrupt();
      }
      return;
    }
    if (echo !== undefined && this.overHodey && !this.bargedIn && ownWords(text, echo) < BARGE_IN_WORDS) {
      // Begun over Hodey, and never more than a word of its own: most likely Hodey heard through the speakers.
      if (this.open) this.armQuietTimer();
      return;
    }
    const said = echo !== undefined ? stripEcho(text, echo) : text;
    if (CLOSERS.test(said.trim())) {
      if (this.deps.getState().phase === "answering") this.deps.dispatch({ type: "DISMISS" });
      return this.end(true);
    }
    this.conversing = this.deps.conversation();
    this.deps.heard?.(said);
    const events = routeUtterance(this.deps.getState(), said, this.deps.packs, this.deps.openAllowed(), this.deps.wakeWords?.() ?? [], this.deps.apps?.() ?? [], this.deps.visionStarting?.() ?? false);
    events.forEach(this.deps.dispatch);
    // Nothing came of it (noise, a thank-you): the learner's turn is still open, but not forever.
    if (events.length === 0 && this.open) this.armQuietTimer();
    if (this.conversing && this.deps.speech.status() === "idle") this.openMic();
  }

  /** Hands-free: overheard speech. Only a wake word counts; heard over Hodey, it stops Hodey at once. */
  onWakeCandidate(text: string, final: boolean): void {
    if (this.deps.speech.status() !== "idle") return;
    const saying = this.deps.hodeySaying();
    if (saying && mayHearHodey(this.deps.speech, this.session) && isEcho(text, saying)) return;
    const rest = wakeRest(text, this.deps.wakeWords?.() ?? []);
    if (rest === undefined) return;
    if (saying) this.deps.interrupt();
    if (!final) return;
    if (!rest) {
      this.deps.speech.start().catch((error: unknown) => console.error("Couldn't listen after the wake word", error));
      return;
    }
    this.conversing = this.deps.conversation();
    this.deps.heard?.(rest);
    routeUtterance(this.deps.getState(), rest, this.deps.packs, this.deps.openAllowed(), this.deps.wakeWords?.() ?? [], this.deps.apps?.() ?? [], this.deps.visionStarting?.() ?? false).forEach(this.deps.dispatch);
    if (this.conversing) this.openMic();
  }

  onHodeyDone(): void {
    // While Hodey is still looking or thinking, its "one sec" isn't the learner's turn yet.
    if (this.open && !BUSY_PHASES.includes(this.deps.getState().phase)) this.armQuietTimer();
  }

  dispose(): void {
    this.clearQuietTimer();
  }

  /** The answer or the Hode was closed: stop listening for a reply to it. */
  close(): void {
    if (this.open || this.opening || this.conversing) this.end(true);
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

  private armQuietTimer(ms = CONVERSATION_PATIENCE_MS): void {
    this.clearQuietTimer();
    this.quietTimer = setTimeout(() => {
      this.quietTimer = undefined;
      if (!BUSY_PHASES.includes(this.deps.getState().phase)) this.end(true);
    }, ms);
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
      const saying = speech.echoCancelled?.() === true ? undefined : hodeySaying();
      if (saying && isEcho(text, saying)) return;
      const said = saying ? stripEcho(text, saying) : text;
      if (said) handler(said, final);
    });
  return view;
}
