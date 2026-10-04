import type { CloudProvider } from "../../data/settings";
import type { ActivityTracker } from "../../lib/activity";
import { speakable } from "../../lib/hinglish";
import { hasDevanagari } from "../../lib/language";
import type { TTSProvider } from "../interfaces";
import { collect, once } from "../speech/native-voice";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** Must match the commands in src-tauri/src/cloud/elevenlabs.rs and src-tauri/src/voice/mod.rs. */
const SPEAK_COMMAND = "elevenlabs_speak";
/** ElevenLabs plays through Hodey's local speaker, so the one barge-in stop silences both. */
const STOP_COMMAND = "tts_stop";
const PROVIDER: CloudProvider = "elevenlabs";

/** A cloud voice, and whether it can say Hindi (Devanagari) text. */
export interface CloudVoice extends TTSProvider {
  readonly multilingual: boolean;
}

/**
 * ElevenLabs Flash v2.5, streamed and played by Rust (the key never reaches the webview). Only
 * Hodey's own sentence is sent. Resolves when playback ends, or at once when the signal aborts.
 */
export class ElevenLabsTTSProvider implements CloudVoice {
  /** Flash v2.5 speaks Hindi and Hinglish with the same voice. */
  readonly multilingual = true;
  /** Speaking speed from settings (1 = normal). */
  rate = 1;

  constructor(private readonly invoke: Invoke) {}

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    const content = speakable(await collect(text, signal));
    if (content === "" || signal.aborted) return;
    let onAbort = () => {};
    const aborted = new Promise<void>((resolve, reject) => {
      onAbort = () => this.stop().then(resolve, reject);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.invoke<boolean>(SPEAK_COMMAND, { text: content, speed: this.rate }), aborted]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  stop(): Promise<void> {
    return this.invoke<void>(STOP_COMMAND);
  }

  /** Whether it may run is the cloud policy's call; the adapter itself is always callable. */
  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/** The slice of `CloudPolicy` the voice needs. */
export interface VoicePolicy {
  allowed(provider: CloudProvider): boolean;
  reportFailure(provider: CloudProvider): void;
  reportSuccess(provider: CloudProvider): void;
}

export interface CloudFirstDeps {
  cloud: CloudVoice;
  local: TTSProvider;
  policy: VoicePolicy;
  activity?: ActivityTracker;
  /** Whether the line being said may leave the PC (lesson lines yes; answers about the screen no). */
  shareable: () => boolean;
}

/**
 * PRD voice order: ElevenLabs when the learner turned it on (and the policy allows it right now),
 * then the local chain. A cloud skip or failure says the same utterance locally.
 */
export class CloudFirstTTS implements TTSProvider {
  constructor(private readonly deps: CloudFirstDeps) {}

  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    const content = await collect(text, signal);
    if (signal.aborted) return;
    if (!this.useCloud(content)) return this.deps.local.speak(once(content), signal);
    try {
      await this.streamCloud(content, signal);
      this.deps.policy.reportSuccess(PROVIDER);
    } catch (error) {
      if (signal.aborted) return;
      console.error("ElevenLabs voice failed; Hodey's local voice says this instead", error);
      this.deps.policy.reportFailure(PROVIDER);
      await this.deps.local.speak(once(content), signal);
    }
  }

  private useCloud(content: string): boolean {
    if (!this.deps.shareable()) return false;
    if (hasDevanagari(content) && !this.deps.cloud.multilingual) return false;
    return this.deps.policy.allowed(PROVIDER);
  }

  private streamCloud(content: string, signal: AbortSignal): Promise<void> {
    const work = () => this.deps.cloud.speak(once(content), signal);
    return this.deps.activity ? this.deps.activity.track("cloud", work) : work();
  }

  async stop(): Promise<void> {
    const results = await Promise.allSettled([this.deps.cloud.stop(), this.deps.local.stop()]);
    results.filter((r) => r.status === "rejected").forEach((r) => console.error("Stopping speech failed", (r as PromiseRejectedResult).reason));
  }

  async healthCheck(): Promise<boolean> {
    const [cloud, local] = await Promise.all([this.deps.cloud.healthCheck(), this.deps.local.healthCheck()]);
    return cloud || local;
  }
}
