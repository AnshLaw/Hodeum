import type { Flag } from "../../lib/flag";
import type { TTSProvider } from "../interfaces";

/**
 * Hodey's voice, with `speaking` on while it talks: from when a line is handed over until it has been said, cut
 * off or failed. A new line can start before the one it cut off settles, so lines in flight are counted.
 */
export function trackSpeaking(tts: TTSProvider, speaking: Flag): TTSProvider {
  let lines = 0;
  return {
    async speak(text, signal) {
      lines += 1;
      speaking.set(true);
      try {
        await tts.speak(text, signal);
      } finally {
        lines -= 1;
        speaking.set(lines > 0);
      }
    },
    stop: () => tts.stop(),
    healthCheck: () => tts.healthCheck(),
  };
}
