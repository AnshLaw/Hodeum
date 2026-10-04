import type { AppPresence } from "../features/dock/dock";
import type { BusEvents } from "../lib/bus";

/** The app window's life around the notch: it unfolds out of it and folds back into it. */
export type FramePhase = "hidden" | "unfolding" | "open" | "minimized" | "folding";
export type FrameEvent = "show" | "unfolded" | "close" | "folded" | "minimized" | "restored";

/** Broadcast by the app so the notch steps aside and the overlay doesn't draw over the app. */
export type AppPresenceState = BusEvents["app:presence"];

const TRANSITIONS: Record<FramePhase, Partial<Record<FrameEvent, FramePhase>>> = {
  hidden: { show: "unfolding" },
  unfolding: { unfolded: "open", close: "folding", minimized: "minimized" },
  open: { close: "folding", minimized: "minimized" },
  // Windows animates the restore itself, so there's no unfold from the taskbar.
  minimized: { show: "open", restored: "open", close: "hidden" },
  folding: { show: "unfolding", folded: "hidden" },
};

/** Events that make no sense in a phase (a second close, a stale "unfolded") leave it unchanged. */
export function nextPhase(phase: FramePhase, event: FrameEvent): FramePhase {
  return TRANSITIONS[phase][event] ?? phase;
}

export function presenceOf(phase: FramePhase): AppPresence {
  if (phase === "unfolding" || phase === "open") return "open";
  return phase === "folding" ? "closing" : "closed";
}

/**
 * The overlay is topmost, so guidance would draw over the app. It steps back only while the learner is
 * actually in the app; switching to their target app brings the highlights back.
 */
export function guidanceHidden(state: AppPresenceState | undefined): boolean {
  return state?.presence === "open" && state.focused;
}
