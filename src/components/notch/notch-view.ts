import { COPY } from "../../lib/copy";
import { AGENT_STYLE_COPY, MODE_COPY } from "../../lib/modes";
import { currentStep, type HodeState } from "../../features/hode/model";
import { skillName } from "../../features/skills/graph";

export type NotchSize = "idle" | "orb" | "compact" | "guidance" | "lesson" | "success" | "phone" | "skills";
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
  | "all_steps"
  /** Agent · Do it for me: carry on past a checkpoint. */
  | "approve"
  /** Agent · Do it for me: the learner does it from here, with guidance. */
  | "take_over";

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
export const NOTCH_WIDTHS: Record<NotchSize, number> = { idle: 196, orb: 44, compact: 380, guidance: 496, lesson: 500, success: 340, phone: 580, skills: 520 };

export const EXPANDED_SIZES: NotchSize[] = ["guidance", "lesson", "success", "phone", "skills"];
const QUIET_LEVELS = new Set(["hint", "observe", "independent"]);

/** Longest learner question shown above an answer before it's shortened. */
const QUESTION_CHARS = 60;
const clip = (text: string) => (text.length > QUESTION_CHARS ? `${text.slice(0, QUESTION_CHARS - 1)}…` : text);

/** The view's words as the learner reads them (Hindi in Devanagari, or in English letters). */
export function inScript(view: NotchView, show: (text: string) => string): NotchView {
  const optional = (text?: string) => (text === undefined ? undefined : show(text));
  return { ...view, title: show(view.title), eyebrow: optional(view.eyebrow), detail: optional(view.detail), hintLabel: optional(view.hintLabel) };
}

export function isExpanded(view: NotchView): boolean {
  return EXPANDED_SIZES.includes(view.size);
}

/** "excel.pivot.create" -> "Pivot · Create" */
export const skillLabel = skillName;

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
  // A step just done right is acknowledged here too, so it's seen when Hodey is muted.
  const eyebrow = s.ack ?? stepEyebrow(s);
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
    controls: ["hint", "explain", ...(silent ? [] : (["let_me_try"] as const)), "repeat", "look_again", ...(s.mode === "teach" ? (["all_steps"] as const) : []), "point", "pause", "end"],
    hintLabel: QUIET_LEVELS.has(s.level) ? COPY.needHint : COPY.hint,
    // Agent shows the whole flow; Teach only once the learner asks for All steps.
    steps: s.mode === "agent" || s.showAllSteps ? stepItems(s) : undefined,
  };
}

function stepEyebrow(s: HodeState): string {
  const mode = s.mode === "agent" ? `${MODE_COPY.agent.title} · ${AGENT_STYLE_COPY[s.agentStyle].title}` : MODE_COPY[s.mode].title;
  if (s.open) return `${COPY.openHode(s.goal)} · ${mode}`;
  return `${COPY.stepOf(Math.min(s.stepIndex + 1, s.pack?.steps.length ?? 0), s.pack?.steps.length ?? 0)} · ${mode}`;
}

/** Agent · Do it for me, about to press: what Hodey is pressing, with time to stop it. */
function actingView(s: HodeState): NotchView {
  const target = s.action?.target;
  const right = currentStep(s)?.press === "right";
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow: stepEyebrow(s),
    title: target ? COPY.acting(target.label, right) : (s.action?.speech ?? ""),
    detail: s.notice ?? COPY.actingDetail,
    progress: s.pack ? { current: s.stepIndex, total: s.pack.steps.length } : undefined,
    busy: true,
    controls: ["take_over", "pause", "end"],
    steps: s.pack ? stepItems(s) : undefined,
  };
}

/** Agent · Do it for me, at a checkpoint: Hodey waits for the learner to check its work. */
function checkpointView(s: HodeState): NotchView {
  const finished = s.pack?.steps[s.stepIndex - 1];
  return {
    mode: "guidance",
    size: "guidance",
    eyebrow: stepEyebrow(s),
    title: COPY.checkpointTitle,
    detail: finished ? COPY.checkpointDetail(finished.objective) : COPY.checkpointOpenDetail,
    progress: s.pack ? { current: s.stepIndex, total: s.pack.steps.length } : undefined,
    busy: false,
    controls: ["approve", "take_over", "point", "end"],
    steps: s.pack ? stepItems(s) : undefined,
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
      return { mode: "answer", size: "guidance", eyebrow: s.spokenQuestion ? COPY.youAsked(clip(s.spokenQuestion)) : COPY.pointAndAsk, title: s.action?.speech ?? "", busy: false, controls: ["dismiss", "repeat"] };
    case "annotating":
      return { mode: "annotate", size: "compact", title: COPY.annotateTitle, detail: COPY.annotateDetail, busy: false, controls: ["cancel_annotate"] };
    case "paused":
      return { mode: "paused", size: "compact", title: COPY.paused, busy: false, controls: ["resume", "end"] };
    case "recovering":
      return { mode: "error", size: "guidance", eyebrow: COPY.idleTitle, title: COPY.somethingWrong, detail: s.notice, busy: false, controls: ["retry", "look_again", "end"] };
    case "acting":
      return actingView(s);
    case "checkpoint":
      return checkpointView(s);
    case "success":
      return successView(s);
  }
}

/** Cards that come with a highlight on the desktop, so they step aside when it's beneath them. */
const PEEK_MODES = new Set<NotchMode>(["guidance", "answer"]);

export interface PeekContext {
  mode: NotchMode;
  /** The highlighted target sits under the expanded card. */
  covering: boolean;
  hovered: boolean;
  menuOpen: boolean;
  skillsOpen: boolean;
}

/** Whether the card shrinks to a slim bar so the learner can see the target under it; hovering brings it back. */
export function shouldPeek({ mode, covering, hovered, menuOpen, skillsOpen }: PeekContext): boolean {
  return covering && !hovered && !menuOpen && !skillsOpen && PEEK_MODES.has(mode);
}

/** Steps Hodey did aren't the learner's skills: then the card says Hodey clicked, and to check the result. */
function successView(s: HodeState): NotchView {
  const hodeyOnly = s.hodeyDid > 0 && s.learnedSkills.length === 0;
  const detail = hodeyOnly ? COPY.hodeyDidIt : COPY.skillLearned;
  return { mode: "success", size: "success", eyebrow: COPY.idleTitle, title: COPY.hodeComplete, detail, busy: false, controls: [], skills: s.learnedSkills.map(skillLabel) };
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
  /** The iPhone mirror is open: the notch grows to hold it beside Hodey's guidance. */
  phone: boolean;
  /** "Your skills" is open from the menu: the notch widens to hold the skill graph. */
  skills?: boolean;
}

/** The shape the top notch takes right now: the view's size, adjusted for hover, menu and peek. */
export function islandSize(view: NotchView, context: IslandContext): NotchSize {
  if (context.menuOpen) return "lesson";
  if (context.skills) return "skills";
  if (context.phone) return "phone";
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

export interface ProviderBadge {
  label: string;
  title: string;
  variant: "local" | "enhanced";
}

/** "● Local" or "☁ Enhanced" (the glyph comes from CSS), per PRD §4.4. */
export function providerBadge(enhanced: boolean): ProviderBadge {
  return enhanced ? { label: COPY.enhanced, title: COPY.enhancedTitle, variant: "enhanced" } : { label: COPY.local, title: COPY.localTitle, variant: "local" };
}

/** Shown on the idle notch when Hodey's natural voice is missing, so the Windows fallback isn't a mystery. */
export function voiceNotice(tts: "loading" | "ready" | "missing" | undefined): string | undefined {
  return tts === "missing" ? COPY.naturalVoiceMissing : undefined;
}
