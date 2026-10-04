import type { SpokenSegment, TTSProvider } from "../interfaces";

/**
 * Passes on one voice's segments for a TTS wrapper, but only while the wrapper has that voice saying one of its
 * lines: once the wrapper uses another voice (the cloud, a Windows voice) or the learner talks over the line,
 * nothing stale gets through.
 */
export class SegmentRelay {
  private readonly lines = new Set<symbol>();

  constructor(private readonly voice: TTSProvider) {}

  /** Says a line with the voice, passing on its segments until the line ends or `signal` aborts. */
  async speak(text: AsyncIterable<string>, signal: AbortSignal): Promise<void> {
    const line = Symbol("line");
    const end = () => {
      this.lines.delete(line);
    };
    this.lines.add(line);
    signal.addEventListener("abort", end, { once: true });
    try {
      await this.voice.speak(text, signal);
    } finally {
      signal.removeEventListener("abort", end);
      end();
    }
  }

  onSegment(listener: (segment: SpokenSegment) => void): () => void {
    if (!this.voice.onSegment) return () => undefined;
    return this.voice.onSegment((segment) => {
      if (this.lines.size > 0) listener(segment);
    });
  }
}
