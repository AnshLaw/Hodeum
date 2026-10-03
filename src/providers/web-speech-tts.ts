import type { TTSProvider } from "./interfaces";

const SPEECH_RATE = 1.05;
const BENIGN_ERRORS = new Set(["canceled", "interrupted"]);

/** Windows native voices through WebView2's speechSynthesis — the PRD's always-available local fallback. */
export class WebSpeechTTSProvider implements TTSProvider {
  /** Speaking speed from the learner's settings (1 = normal). */
  rate = SPEECH_RATE;

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    let content = "";
    for await (const chunk of text) {
      if (signal.aborted) return;
      content += chunk;
    }
    if (content.trim() === "" || signal.aborted) return;
    const synth = window.speechSynthesis;
    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.rate = this.rate;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => (BENIGN_ERRORS.has(event.error) ? resolve() : reject(new Error(`Speech synthesis failed: ${event.error}`)));
      signal.addEventListener("abort", () => synth.cancel(), { once: true });
      synth.speak(utterance);
    });
  }

  async stop(): Promise<void> {
    window.speechSynthesis.cancel();
  }

  async healthCheck(): Promise<boolean> {
    return "speechSynthesis" in window;
  }
}
