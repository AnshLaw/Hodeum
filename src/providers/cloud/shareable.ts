import type { HodeState } from "../../features/hode/model";

/**
 * Whether what Hodey says now may go to a cloud voice: a lesson Hode's own lines only. Answers to
 * questions and open-ended guidance come from the screen, so they stay on the local voice.
 */
export function lessonSpeech(state: HodeState): boolean {
  if (!state.pack || state.open) return false;
  if (state.phase === "answering" || state.spokenQuestion || state.question) return false;
  return state.phase !== "idle";
}
