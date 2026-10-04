import type { TaskPack } from "../../lib/types";
import type { SpeechInput } from "../../providers/speech/speech-input";
import type { HodeEvent, HodePhase, HodeState } from "../hode/model";
import { routeUtterance } from "./route";

const BUSY_PHASES: HodePhase[] = ["observing", "reasoning"];

/** Share of heard words that must appear in Hodey's own sentence for it to count as echo. */
const ECHO_OVERLAP = 0.7;

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

const wordsOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").split(/\s+/).filter(Boolean);

/** Whether the mic most likely picked up Hodey's own speech rather than the learner. */
export function isEcho(heard: string, said: string): boolean {
  const heardWords = wordsOf(heard);
  if (heardWords.length === 0) return false;
  const saidWords = new Set(wordsOf(said));
  const shared = heardWords.filter((w) => saidWords.has(w)).length;
  return shared / heardWords.length >= ECHO_OVERLAP;
}

/**
 * Wires local speech to the Hode, as a conversation. Barge-in: if Hodey is silent, any speech stops it at once; while it
 * talks, speech interrupts as soon as the words aren't its own (no echo cancellation on speakers).
 * Final transcripts become Hode events unless they're just Hodey's words coming back.
 */
export function connectVoice(deps: VoiceDeps): () => void {
  /** The learner started talking to Hodey, so after each answer the mic reopens for their reply. */
  let conversing = false;
  let session = { open: false, heardSomething: false };
  const offs = [
    deps.speech.onStatus((status) => {
      if (status === "listening") {
        // Tapping the mic means "I want to talk": Hodey stops at once.
        deps.interrupt();
        session = { open: true, heardSomething: false };
      } else if (session.open) {
        session.open = false;
        // A turn with nothing said (a follow-up nobody answered) ends the conversation.
        if (!session.heardSomething) conversing = false;
      }
    }),
    deps.speech.onSpeechStart(() => {
      if (!deps.hodeySaying()) deps.interrupt();
    }),
    deps.speech.onTranscript((text, final) => {
      const saying = deps.hodeySaying();
      if (saying && isEcho(text, saying)) return;
      if (!final) {
        if (saying) deps.interrupt();
        return;
      }
      session.heardSomething = true;
      if (CLOSERS.test(text.trim())) {
        conversing = false;
        return;
      }
      conversing = deps.conversation();
      routeUtterance(deps.getState(), text, deps.packs, deps.openAllowed(), deps.wakeWords?.() ?? []).forEach(deps.dispatch);
    }),
    deps.onHodeyDoneSpeaking(() => {
      // While Hodey is still looking or thinking, its "one sec" isn't the learner's turn yet.
      const thinking = BUSY_PHASES.includes(deps.getState().phase);
      if (!conversing || thinking || deps.speech.status() !== "idle" || !deps.speech.followUp) return;
      deps.speech.followUp().catch((error: unknown) => {
        conversing = false;
        console.error("Couldn't listen for a reply", error);
      });
    }),
  ];
  return () => offs.forEach((off) => off());
}
