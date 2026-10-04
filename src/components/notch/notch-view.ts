import { COPY } from "../../lib/copy";
import { MODE_COPY } from "../../lib/modes";
import { currentStep, type HodeState } from "../../features/hode/model";

export type NotchSize = "idle" | "orb" | "compact" | "guidance" | "lesson" | "success";
export type NotchMode = "idle" | "goal" | "status" | "guidance" | "answer" | "annotate" | "paused" | "error" | "success";
export type NotchControl =
  | "start"
  | "point"
  | "hint"
  | "explain"
  | "let_me_try"
  | "pause"
  | "resume"
  | "end"
  | "retry"
  | "dismiss"
  | "cancel_annotate"
  | "repeat"
  | "look_again"
  | "all_steps";

export interface NotchView {
  mode: NotchMode;
  size: NotchSize;
  title: string;
  eyebrow?: string;
  detail?: string;
  progress?: { current: number; total: number };
  busy: boolean;
  controls: NotchControl[];
  hintLabel?: string;
  skills?: string[];
  /** The whole flow, when the learner asked to see it. */
  steps?: StepItem[];
}

/** Pill widths in CSS px, per PRD §8.2. Height follows content. */
export const NOTCH_WIDTHS: Record<NotchSize, number> = { idle: 196, orb: 44, compact: 380, guidance: 496, lesson: 500, success: 340 };

const EXPANDED: NotchSize[] = ["guidance", "lesson", "success"];
const QUIET_LEVELS = new Set(["hint", "observe", "independent"]);

export function isExpanded(view: NotchView): boolean {
  return EXPANDED.includes(view.size);
}

/** "excel.pivot.create" -> "Pivot · Create" */
export function skillLabel(skillId: string): string {
  const [, ...parts] = skillId.split(".");
  return parts
    .map((part) => {
      const words = part.replace(/_/g, " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(" · ");
}

/** Help mode while Hodey is just watching: the learner drives, the step isn't spelled out. */
function standingByView(s: HodeState, eyebrow: string, total: number): NotchView {
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow,
    title: COPY.helpStandingBy,
    detail: s.notice,
    progress: { current: s.stepIndex, total },
    busy: false,
    controls: ["hint", "point", "pause", "end"],
    hintLabel: COPY.needHint,
  };
}

function guidanceView(s: HodeState): NotchView {
  if (s.open) return openGuidanceView(s);
  const step = currentStep(s);
  const total = s.pack?.steps.length ?? 0;
  const silent = s.level === "observe" || s.level === "independent";
  const eyebrow = `${COPY.stepOf(s.stepIndex + 1, total)} · ${MODE_COPY[s.mode].title}`;
  if (s.mode === "help" && silent && !s.correction) return standingByView(s, eyebrow, total);
  const speech = s.action?.speech ?? "";
  const showObjective = speech === "" || (silent && s.action?.kind === "guide");
  const prerequisites = s.stepIndex === 0 ? s.pack?.prerequisites.join(" ") : undefined;
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow,
    title: showObjective ? `${COPY.yourTurn}: ${step?.objective ?? ""}` : speech,
    detail: s.explanation ?? s.notice ?? prerequisites,
    progress: { current: s.stepIndex, total },
    busy: false,
    controls: ["hint", "explain", ...(silent ? [] : (["let_me_try"] as const)), "repeat", "look_again", ...(s.mode === "help" ? [] : (["all_steps"] as const)), "point", "pause", "end"],
    hintLabel: QUIET_LEVELS.has(s.level) ? COPY.needHint : COPY.hint,
    steps: s.showAllSteps ? stepItems(s) : undefined,
  };
}

/** Open-ended Hode: the goal is the eyebrow and there's no step list or Explain text. */
function openGuidanceView(s: HodeState): NotchView {
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow: COPY.openHode(s.goal),
    title: s.action?.speech ?? "",
    detail: s.notice,
    busy: false,
    controls: ["hint", "repeat", "look_again", "point", "pause", "end"],
    hintLabel: COPY.needHint,
  };
}

export function notchView(s: HodeState): NotchView {
  switch (s.phase) {
    case "idle":
      return { mode: "idle", size: "idle", title: COPY.idleTitle, detail: s.notice, busy: false, controls: ["start", "point"] };
    case "goal_entry":
      return { mode: "goal", size: "lesson", title: COPY.startHode, detail: s.notice, busy: false, controls: [] };
    case "observing":
    case "reasoning":
      return { mode: "status", size: "orb", title: COPY.looking, busy: true, controls: ["pause"] };
    case "guiding":
      return guidanceView(s);
    case "answering":
      return { mode: "answer", size: "guidance", eyebrow: COPY.pointAndAsk, title: s.action?.speech ?? "", busy: false, controls: ["dismiss", "repeat"] };
    case "annotating":
      return { mode: "annotate", size: "compact", title: COPY.annotateTitle, detail: COPY.annotateDetail, busy: false, controls: ["cancel_annotate"] };
    case "paused":
      return { mode: "paused", size: "compact", title: COPY.paused, busy: false, controls: ["resume", "end"] };
    case "recovering":
      return { mode: "error", size: "guidance", eyebrow: COPY.idleTitle, title: COPY.somethingWrong, detail: s.notice, busy: false, controls: ["retry", "look_again", "end"] };
    case "success":
      return { mode: "success", size: "success", eyebrow: COPY.idleTitle, title: COPY.hodeComplete, detail: COPY.skillLearned, busy: false, controls: [], skills: s.learnedSkills.map(skillLabel) };
  }
}

export interface IslandContext {
  /** Hodey has been busy long enough that shrinking won't flicker. */
  settled: boolean;
  hovered: boolean;
  menuOpen: boolean;
  /** The highlighted control sits under the card. */
  peek: boolean;
  /** The microphone is on: the pill and orb open into a bar showing what Hodey hears. */
  listening: boolean;
}

/** The shape the top notch takes right now: the view's size, adjusted for hover, menu and peek. */
export function islandSize(view: NotchView, context: IslandContext): NotchSize {
  if (context.menuOpen) return "lesson";
  if (context.listening && (view.size === "idle" || view.size === "orb")) return "compact";
  if (view.size === "orb") return context.settled && !context.hovered ? "orb" : "compact";
  if (context.peek) return "compact";
  return view.size;
}

export type StepState = "done" | "current" | "todo";

export interface StepItem {
  id: string;
  objective: string;
  state: StepState;
}

/**
 * The Hode as a checklist. Agent mode shows it all; teach mode shows what's done and the current
 * step until the learner asks for the whole flow; help mode keeps it out of the way.
 */
export function stepItems(s: HodeState): StepItem[] {
  if (!s.pack || s.mode === "help") return [];
  const finished = s.phase === "success";
  const items: StepItem[] = s.pack.steps.map((step, index) => ({
    id: step.id,
    objective: step.objective,
    state: finished || index < s.stepIndex ? "done" : index === s.stepIndex ? "current" : "todo",
  }));
  const revealAll = s.mode === "agent" || s.showAllSteps || finished;
  return revealAll ? items : items.filter((item) => item.state !== "todo");
}
