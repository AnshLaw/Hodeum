import { COPY } from "../../lib/copy";

export type SpeechInputStatus = "unavailable" | "idle" | "listening";

/**
 * Local speech-to-text (Nemotron via NeMo-Speech.cpp, faster-whisper as fallback — sub-project 4).
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
}
