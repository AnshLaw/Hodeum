import { speakable } from "../../lib/hinglish";
import { DEFAULT_HINDI_VOICE } from "../../data/settings";
import { hasDevanagari } from "../../lib/language";
import type { SpokenCopy } from "../../lib/spoken";
import type { TTSProvider } from "../interfaces";
import type { SpeechInput, SpeechInputStatus } from "./speech-input";

/** Mirrors `VoiceStatus` in src-tauri/src/voice/mod.rs. */
export interface VoiceStatus {
  asr: "ready" | "missing";
  tts: "loading" | "ready" | "missing";
  listening: boolean;
  /** Hands-free: the mic is on, waiting for "Hey Hodey". */
  standby: boolean;
  /** Why the mic can't be used, what it's doing, or (while ready) that the Whisper backup engine is listening. */
  detail: string | null;
  tts_detail: string | null;
  /** Hodey's natural voices on this PC (Kokoro first, then Supertonic). */
  voices: NaturalVoice[];
  /** The speech engine listening now ("nemotron" or "whisper"); null until one has loaded. */
  asrEngine?: string | null;
  /** Windows' echo cancellation is cleaning the microphone now, so Hodey's voice isn't in it. */
  echoCancelled: boolean;
  /** The microphone Hodey listens on (every mode uses the same one), once one has been opened. */
  mic: string | null;
  /** The GPU model re-reading each finished utterance ("whisper-small-gpu"); null: Nemotron's text only. */
  refine: string | null;
}

/** Mirrors `VoiceOption` in src-tauri/src/voice/voices.rs. */
export interface NaturalVoice {
  id: string;
  label: string;
  /** Accent and voice, e.g. "American · female". */
  description: string;
}

/** Must match the event names in src-tauri/src/voice. */
const STATUS_EVENT = "voice:status";
const TRANSCRIPT_EVENT = "voice:transcript";
const SPEECH_START_EVENT = "voice:speech-start";
const ERROR_EVENT = "voice:error";
const WAKE_EVENT = "voice:wake-candidate";
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

  converse(): Promise<void> {
    return this.bridge.invoke<void>("voice_converse");
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

  onWakeCandidate(handler: (text: string, final: boolean) => void): () => void {
    return this.bridge.listen<{ text: string; final: boolean }>(WAKE_EVENT, ({ text, final }) => handler(text, final));
  }

  /** Hands-free on or off, and the learner's own wake words for the Rust side's quick first-word check. */
  setHandsFree(enabled: boolean, wakeWords: string[]): Promise<void> {
    return this.bridge.invoke<void>("set_hands_free", { enabled, wakeWords });
  }

  echoCancelled(): boolean {
    return this.voice.current()?.echoCancelled === true;
  }

  warmMic(): Promise<void> {
    return this.bridge.invoke<void>("voice_warm_mic");
  }

  /** Words the learner is likely to say now (the task's controls, app names), so the GPU's second listen spells them right. */
  setSpeechHints(hints: string[]): Promise<void> {
    return this.bridge.invoke<void>("set_speech_hints", { hints });
  }
}

/**
 * Hodey's short, frequent lines in `language`: the quick acknowledgements and the "that's right" after a step.
 * Synthesized ahead of time so each plays at once (the Rust side keeps a prepared line as its own chunk).
 */
export function frequentLines(words: Pick<SpokenCopy, "acks" | "stepDone" | "stepDoneLight" | "rememberedOnYourOwn" | "gotTheHang">): string[] {
  return [...new Set([...words.acks, ...words.stepDone, ...words.stepDoneLight, words.rememberedOnYourOwn, words.gotTheHang])];
}

/** The whole utterance from a text stream; empty if it was aborted part way. */
export async function collect(text: AsyncIterable<string>, signal: AbortSignal): Promise<string> {
  let content = "";
  for await (const chunk of text) {
    if (signal.aborted) return "";
    content += chunk;
  }
  return content.trim();
}

/** Hodey's natural voice (Kokoro, else Supertonic), synthesized and played on this PC. */
export class NativeTTSProvider implements TTSProvider {
  /** Speaking speed from settings (1 = normal). */
  rate = 1;
  /** A natural voice id like "kokoro:3"; empty for Hodey's default. */
  voiceId = "";
  /** The voice for Hindi sentences (Devanagari text). */
  hindiVoiceId = DEFAULT_HINDI_VOICE;

  constructor(private readonly bridge: VoiceBridge, private readonly voice?: NativeVoiceStatus) {}

  private voiceFor(text: string): string {
    return hasDevanagari(text) ? this.hindiVoiceId : this.voiceId;
  }

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    const content = speakable(await collect(text, signal));
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
    await this.bridge.invoke<void>("tts_speak", { id, text: content, voiceId: this.voiceFor(content), speed: this.rate });
    await finished;
  }

  stop(): Promise<void> {
    return this.bridge.invoke<void>("tts_stop");
  }

  /** Synthesizes likely lines ahead of time (silently) so they start instantly when needed. */
  async prepare(lines: string[]): Promise<void> {
    const texts = lines.map(speakable);
    const hindi = texts.filter(hasDevanagari);
    const english = texts.filter((text) => !hasDevanagari(text));
    if (english.length > 0) await this.bridge.invoke<void>("tts_prepare", { texts: english, voiceId: this.voiceId, speed: this.rate });
    if (hindi.length > 0) await this.bridge.invoke<void>("tts_prepare", { texts: hindi, voiceId: this.hindiVoiceId, speed: this.rate });
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
    const content = await collect(text, signal);
    // Windows' English voices can't read Hindi; Hindi always goes to Hodey's Hindi voice.
    if (!this.useNatural() && !hasDevanagari(content)) return this.windows.speak(once(content), signal);
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

export async function* once(text: string): AsyncGenerator<string> {
  yield text;
}

/** Saved in settings as `hodey:<voice id>` for a natural voice; anything else is a Windows voice URI. */
export const NATURAL_PREFIX = "hodey:";

export type VoiceChoice = { engine: "natural"; id: string } | { engine: "windows"; uri: string };

/** The learner's voice setting. Empty means the default: Hodey's natural voice when installed. */
export function voiceChoice(name: string): VoiceChoice {
  if (name === "") return { engine: "natural", id: "" };
  if (!name.startsWith(NATURAL_PREFIX)) return { engine: "windows", uri: name };
  return { engine: "natural", id: name.slice(NATURAL_PREFIX.length) };
}
