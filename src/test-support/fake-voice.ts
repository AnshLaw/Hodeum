import { vi } from "vitest";
import type { SpokenSegment, TTSProvider } from "../providers/interfaces";

/**
 * A voice that can tell which part of a line it's saying, for testing TTS wrappers. Each line plays until
 * `finish()` (or its signal aborts), and `report()` sends a segment to whoever listens, speaking or not.
 */
export function fakeSegmentedVoice() {
  const listeners = new Set<(segment: SpokenSegment) => void>();
  const lines: string[] = [];
  let finish = () => {};
  const voice: TTSProvider = {
    speak: vi.fn(async (text: AsyncIterable<string>, signal: AbortSignal) => {
      let line = "";
      for await (const part of text) line += part;
      lines.push(line);
      await new Promise<void>((resolve) => {
        finish = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }),
    stop: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => true),
    onSegment(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return { voice, lines, report: (segment: SpokenSegment) => listeners.forEach((listener) => listener(segment)), finish: () => finish() };
}
