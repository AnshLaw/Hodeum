import { type HodeState } from "../../features/hode/model";

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
      return "thinking";
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
    case "success":
      return "celebrating";
  }
}
