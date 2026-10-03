import { COPY } from "../../lib/copy";
import { currentStep, type HodeState } from "../../features/hode/model";

export type NotchSize = "idle" | "compact" | "guidance" | "lesson" | "success";
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
  | "cancel_annotate";

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
}

/** Pill widths in CSS px, per PRD §8.2. Height follows content. */
export const NOTCH_WIDTHS: Record<NotchSize, number> = { idle: 196, compact: 380, guidance: 440, lesson: 500, success: 340 };
export const NOTCH_IDLE_HOVER_WIDTH = 304;

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

function guidanceView(s: HodeState): NotchView {
  const step = currentStep(s);
  const total = s.pack?.steps.length ?? 0;
  const silent = s.level === "observe" || s.level === "independent";
  const speech = s.action?.speech ?? "";
  const showObjective = speech === "" || (silent && s.action?.kind === "guide");
  const prerequisites = s.stepIndex === 0 ? s.pack?.prerequisites.join(" ") : undefined;
  if (s.open) return openGuidanceView(s);
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow: COPY.stepOf(s.stepIndex + 1, total),
    title: showObjective ? `${COPY.yourTurn}: ${step?.objective ?? ""}` : speech,
    detail: s.explanation ?? s.notice ?? prerequisites,
    progress: { current: s.stepIndex, total },
    busy: false,
    controls: ["hint", "explain", ...(silent ? [] : (["let_me_try"] as const)), "point", "pause", "end"],
    hintLabel: QUIET_LEVELS.has(s.level) ? COPY.needHint : COPY.hint,
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
    controls: ["hint", "point", "pause", "end"],
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
      return { mode: "status", size: "compact", title: COPY.looking, busy: true, controls: ["pause"] };
    case "guiding":
      return guidanceView(s);
    case "answering":
      return { mode: "answer", size: "guidance", eyebrow: COPY.pointAndAsk, title: s.action?.speech ?? "", busy: false, controls: ["dismiss"] };
    case "annotating":
      return { mode: "annotate", size: "compact", title: COPY.annotateTitle, detail: COPY.annotateDetail, busy: false, controls: ["cancel_annotate"] };
    case "paused":
      return { mode: "paused", size: "compact", title: COPY.paused, busy: false, controls: ["resume", "end"] };
    case "recovering":
      return { mode: "error", size: "guidance", eyebrow: COPY.idleTitle, title: COPY.somethingWrong, detail: s.notice, busy: false, controls: ["retry", "end"] };
    case "success":
      return { mode: "success", size: "success", eyebrow: COPY.idleTitle, title: COPY.hodeComplete, detail: COPY.skillLearned, busy: false, controls: [], skills: s.learnedSkills.map(skillLabel) };
  }
}

export type StepState = "done" | "current" | "todo";

export interface StepItem {
  id: string;
  objective: string;
  state: StepState;
}

/** The whole Hode as a checklist, for the sidebar. */
export function stepItems(s: HodeState): StepItem[] {
  if (!s.pack) return [];
  const finished = s.phase === "success";
  return s.pack.steps.map((step, index) => ({
    id: step.id,
    objective: step.objective,
    state: finished || index < s.stepIndex ? "done" : index === s.stepIndex ? "current" : "todo",
  }));
}
