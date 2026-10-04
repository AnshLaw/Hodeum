import { COPY } from "../../lib/copy";

export type SpeechInputStatus = "unavailable" | "idle" | "listening";

/**
 * Local speech-to-text. While listening, voice activity detection runs on this PC.
 * While listening, the orange privacy dot is on.
 */
export interface SpeechInput {
  status(): SpeechInputStatus;
  /** Why the mic can't be used, shown to the learner instead of a dead button. */
  unavailableReason(): string | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
  onStatus(handler: (status: SpeechInputStatus) => void): () => void;
  onTranscript(handler: (text: string, final: boolean) => void): () => void;
  /** The learner started talking (voice activity detected): Hodey stops speaking right away. */
  onSpeechStart(handler: () => void): () => void;
  /** In a conversation, after Hodey speaks: listen briefly for a reply (ends quietly if none comes). */
  followUp?(): Promise<void>;
  /** Hands-free: a sentence overheard while waiting for "Hey Hodey". Only for wake-word checks; never stored. */
  onWakeCandidate?(handler: (text: string) => void): () => void;
  /** Problems worth telling the learner about, e.g. a muted microphone. */
  onError?(handler: (message: string) => void): () => void;
}

/**
 * Until local speech recognition is installed. The browser's built-in recognition is deliberately
 * not used: in WebView2 it streams audio to a cloud service, which breaks the local-first promise.
 */
export class UnavailableSpeechInput implements SpeechInput {
  status(): SpeechInputStatus {
    return "unavailable";
  }

  unavailableReason(): string {
    return COPY.voiceNotInstalled;
  }

  async start(): Promise<void> {
    throw new Error(COPY.voiceNotInstalled);
  }

  async stop(): Promise<void> {}

  onStatus(): () => void {
    return () => undefined;
  }

  onTranscript(): () => void {
    return () => undefined;
  }

  onSpeechStart(): () => void {
    return () => undefined;
  }
}
