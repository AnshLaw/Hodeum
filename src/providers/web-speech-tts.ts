import type { TTSProvider } from "./interfaces";

/**
 * The learner's chosen voice if it's installed, else the default on-device voice. Never an online
 * voice: those send what Hodey says to a cloud service.
 */
export function pickVoice(voices: SpeechSynthesisVoice[], name: string): SpeechSynthesisVoice | undefined {
  const local = voices.filter((voice) => voice.localService);
  return local.find((voice) => voice.voiceURI === name) ?? local.find((voice) => voice.default) ?? local[0];
}

const SPEECH_RATE = 1.05;
const BENIGN_ERRORS = new Set(["canceled", "interrupted"]);

/** Windows native voices through WebView2's speechSynthesis — the PRD's always-available local fallback. */
export class WebSpeechTTSProvider implements TTSProvider {
  /** Speaking speed from the learner's settings (1 = normal). */
  rate = SPEECH_RATE;
  /** A local voice URI from settings; empty for the system default. */
  voiceName = "";

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
      const voice = pickVoice(synth.getVoices(), this.voiceName);
      if (voice) utterance.voice = voice;
      else console.error("No on-device voice is installed; Windows will pick one");
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
