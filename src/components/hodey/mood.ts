import { rechecking, type HodeState } from "../../features/hode/model";

/** What Hodey's face is doing. Each mood is an animated expression in `HodeyFace`. */
export type HodeyMood =
  | "sleeping"
  | "awake"
  | "listening"
  | "looking"
  | "thinking"
  | "guiding"
  | "watching"
  | "correcting"
  | "speaking"
  | "curious"
  | "resting"
  | "confused"
  | "celebrating";

export const HODEY_MOODS: HodeyMood[] = [
  "sleeping",
  "awake",
  "listening",
  "looking",
  "thinking",
  "guiding",
  "watching",
  "correcting",
  "speaking",
  "curious",
  "resting",
  "confused",
  "celebrating",
];

/** Learner-facing names, used for the face's accessible label. */
export const MOOD_LABELS: Record<HodeyMood, string> = {
  sleeping: "Hodey is resting",
  awake: "Hodey is awake",
  listening: "Hodey is listening",
  looking: "Hodey is looking at this screen",
  thinking: "Hodey is thinking",
  guiding: "Hodey is showing you the next step",
  watching: "Hodey is watching you try",
  correcting: "Hodey noticed something",
  speaking: "Hodey is explaining",
  curious: "Hodey is looking where you point",
  resting: "Hodey is paused",
  confused: "Hodey hit a problem",
  celebrating: "Hode complete",
};

function guidingMood(s: HodeState): HodeyMood {
  if (s.action?.kind === "correct") return "correcting";
  if (s.level === "observe" || s.level === "independent") return "watching";
  return "guiding";
}

export function hodeyMood(s: HodeState, hovered: boolean): HodeyMood {
  switch (s.phase) {
    case "idle":
      return hovered ? "awake" : "sleeping";
    case "goal_entry":
      return "listening";
    case "observing":
      return "looking";
    case "reasoning":
      // A slow reasoner at work shows on Hodey's face, even while the guidance card stays up.
      return s.thinking === true || !rechecking(s) ? "thinking" : guidingMood(s);
    case "guiding":
      return guidingMood(s);
    case "answering":
      return "speaking";
    case "annotating":
      return "curious";
    case "paused":
      return "resting";
    case "recovering":
      return "confused";
    case "acting":
      return "guiding";
    case "checkpoint":
      return "watching";
    case "success":
      return "celebrating";
  }
}

/**
 * Hodey's face with its voice in it: listening whenever the mic is open, and talking while it speaks with no Hode
 * (a greeting, an app opened by voice), which the notch stays out to show. During a Hode, the Hode's face.
 */
export function faceMood(s: HodeState, hovered: boolean, voice: { listening: boolean; speaking: boolean }): HodeyMood {
  if (voice.listening) return "listening";
  if (voice.speaking && s.phase === "idle") return "speaking";
  return hodeyMood(s, hovered);
}
