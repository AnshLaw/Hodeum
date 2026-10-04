import type { TaskPack } from "../../lib/types";
import type { SpeechInput } from "../../providers/speech/speech-input";
import type { HodeEvent, HodeState } from "../hode/model";
import { routeUtterance } from "./route";

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
}

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
 * Wires local speech to the Hode. Barge-in: if Hodey is silent, any speech stops it at once; while it
 * talks, speech interrupts as soon as the words aren't its own (no echo cancellation on speakers).
 * Final transcripts become Hode events unless they're just Hodey's words coming back.
 */
export function connectVoice(deps: VoiceDeps): () => void {
  const offs = [
    // Tapping the mic means "I want to talk": Hodey stops at once.
    deps.speech.onStatus((status) => {
      if (status === "listening") deps.interrupt();
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
      routeUtterance(deps.getState(), text, deps.packs, deps.openAllowed()).forEach(deps.dispatch);
    }),
  ];
  return () => offs.forEach((off) => off());
}
