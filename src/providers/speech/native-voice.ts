import type { TTSProvider } from "../interfaces";
import type { SpeechInput, SpeechInputStatus } from "./speech-input";

/** Mirrors `VoiceStatus` in src-tauri/src/voice/mod.rs. */
export interface VoiceStatus {
  asr: "ready" | "missing";
  tts: "loading" | "ready" | "missing";
  listening: boolean;
  detail: string | null;
  tts_detail: string | null;
  /** Supertonic voices available. */
  voices: number;
}

/** Must match the event names in src-tauri/src/voice. */
const STATUS_EVENT = "voice:status";
const TRANSCRIPT_EVENT = "voice:transcript";
const SPEECH_START_EVENT = "voice:speech-start";
const ERROR_EVENT = "voice:error";
const DONE_EVENT = "tts:done";
const NOT_READY = "Hodey's voice is still starting.";

/** The slice of Tauri the voice adapters need, injectable for tests. */
export interface VoiceBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): () => void;
}

/** Live voice status from the Rust side, shared by the speech input and the speaker. */
export class NativeVoiceStatus {
  private status: VoiceStatus | undefined;
  private readonly listeners = new Set<(status: VoiceStatus) => void>();

  constructor(bridge: VoiceBridge) {
    bridge.listen<VoiceStatus>(STATUS_EVENT, (next) => this.set(next));
    bridge.invoke<VoiceStatus>("voice_status").then(
      (initial) => this.status ?? this.set(initial),
      (error) => console.error("Couldn't read Hodey's voice status", error),
    );
  }

  current(): VoiceStatus | undefined {
    return this.status;
  }

  subscribe(listener: (status: VoiceStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(next: VoiceStatus): void {
    this.status = next;
    this.listeners.forEach((listener) => listener(next));
  }
}

const statusOf = (s: VoiceStatus | undefined): SpeechInputStatus => (!s || s.asr !== "ready" ? "unavailable" : s.listening ? "listening" : "idle");

/** NVIDIA Nemotron speech recognition on this PC, through Rust. Audio never leaves the PC. */
export class NativeSpeechInput implements SpeechInput {
  readonly voice: NativeVoiceStatus;

  constructor(private readonly bridge: VoiceBridge, voice?: NativeVoiceStatus) {
    this.voice = voice ?? new NativeVoiceStatus(bridge);
  }

  status(): SpeechInputStatus {
    return statusOf(this.voice.current());
  }

  unavailableReason(): string | undefined {
    const s = this.voice.current();
    if (!s) return NOT_READY;
    return s.asr === "ready" ? undefined : (s.detail ?? NOT_READY);
  }

  start(): Promise<void> {
    return this.bridge.invoke<void>("voice_start");
  }

  stop(): Promise<void> {
    return this.bridge.invoke<void>("voice_stop");
  }

  onStatus(handler: (status: SpeechInputStatus) => void): () => void {
    let last = this.status();
    return this.voice.subscribe((s) => {
      const next = statusOf(s);
      if (next !== last) handler(next);
      last = next;
    });
  }

  onTranscript(handler: (text: string, final: boolean) => void): () => void {
    return this.bridge.listen<{ text: string; final: boolean }>(TRANSCRIPT_EVENT, ({ text, final }) => handler(text, final));
  }

  onSpeechStart(handler: () => void): () => void {
    return this.bridge.listen<null>(SPEECH_START_EVENT, () => handler());
  }

  onError(handler: (message: string) => void): () => void {
    return this.bridge.listen<string>(ERROR_EVENT, handler);
  }
}

async function collect(text: AsyncIterable<string>, signal: AbortSignal): Promise<string> {
  let content = "";
  for await (const chunk of text) {
    if (signal.aborted) return "";
    content += chunk;
  }
  return content.trim();
}

/** Supertonic, Hodey's natural voice, synthesized and played on this PC. */
export class NativeTTSProvider implements TTSProvider {
  /** Speaking speed from settings (1 = normal). */
  rate = 1;
  /** Which Supertonic voice. */
  voiceId = 0;

  constructor(private readonly bridge: VoiceBridge, private readonly voice?: NativeVoiceStatus) {}

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    const content = await collect(text, signal);
    if (content === "" || signal.aborted) return;
    const id = crypto.randomUUID();
    const finished = new Promise<void>((resolve, reject) => {
      const off = this.bridge.listen<{ id: string; error: string | null }>(DONE_EVENT, (done) => {
        if (done.id !== id) return;
        off();
        if (done.error) reject(new Error(done.error));
        else resolve();
      });
      signal.addEventListener("abort", () => {
        off();
        this.stop().then(resolve, reject);
      }, { once: true });
    });
    await this.bridge.invoke<void>("tts_speak", { id, text: content, voiceId: this.voiceId, speed: this.rate });
    await finished;
  }

  stop(): Promise<void> {
    return this.bridge.invoke<void>("tts_stop");
  }

  async healthCheck(): Promise<boolean> {
    return this.voice?.current()?.tts === "ready";
  }
}

/**
 * The PRD's local TTS chain: Supertonic when it's installed and chosen, Windows voices otherwise,
 * and Windows voices for any single utterance Supertonic fails on.
 */
export class RoutedTTS implements TTSProvider {
  constructor(
    private readonly natural: TTSProvider,
    private readonly windows: TTSProvider,
    private readonly useNatural: () => boolean,
  ) {}

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    if (!this.useNatural()) return this.windows.speak(text, signal);
    const content = await collect(text, signal);
    try {
      await this.natural.speak(once(content), signal);
    } catch (error) {
      if (signal.aborted) return;
      console.error("Hodey's natural voice failed; using a Windows voice", error);
      await this.windows.speak(once(content), signal);
    }
  }

  async stop(): Promise<void> {
    const results = await Promise.allSettled([this.natural.stop(), this.windows.stop()]);
    results.filter((r) => r.status === "rejected").forEach((r) => console.error("Stopping speech failed", (r as PromiseRejectedResult).reason));
  }

  async healthCheck(): Promise<boolean> {
    return (await this.natural.healthCheck()) || this.windows.healthCheck();
  }
}

async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

/** Saved in settings as `hodey:<n>` for a Supertonic voice; anything else is a Windows voice URI. */
export const NATURAL_PREFIX = "hodey:";

export type VoiceChoice = { engine: "natural"; id: number } | { engine: "windows"; uri: string };

/** The learner's voice setting. Empty means the default: Hodey's natural voice when installed. */
export function voiceChoice(name: string): VoiceChoice {
  if (name === "") return { engine: "natural", id: 0 };
  if (!name.startsWith(NATURAL_PREFIX)) return { engine: "windows", uri: name };
  const id = Number.parseInt(name.slice(NATURAL_PREFIX.length), 10);
  return { engine: "natural", id: Number.isInteger(id) && id >= 0 ? id : 0 };
}
