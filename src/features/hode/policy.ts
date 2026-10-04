import { padRect } from "../../lib/coords";
import {
  ASSISTANCE_LEVELS,
  type AssistanceLevel,
  type HodeMode,
  type OverlayPrimitive,
  type Rect,
  type SkillRecord,
  type StepOutcome,
  type TeachingAction,
} from "../../lib/types";

export const CONFIDENCE_PRECISE = 0.85;
export const CONFIDENCE_BROAD = 0.65;
export const BROAD_PADDING_PX = 24;

const MOST_HELP = 0;
const LEAST_HELP = ASSISTANCE_LEVELS.length - 1;
const CONFIDENCE_DECIMALS = 100;

/** One step toward more help (demonstrate). */
export function escalate(level: AssistanceLevel): AssistanceLevel {
  return ASSISTANCE_LEVELS[Math.max(MOST_HELP, ASSISTANCE_LEVELS.indexOf(level) - 1)];
}

/** One step toward less help (independent). */
export function relax(level: AssistanceLevel): AssistanceLevel {
  return ASSISTANCE_LEVELS[Math.min(LEAST_HELP, ASSISTANCE_LEVELS.indexOf(level) + 1)];
}

const indexOf = (level: AssistanceLevel) => ASSISTANCE_LEVELS.indexOf(level);
/** Of two levels, the one giving less help. */
const quieter = (a: AssistanceLevel, b: AssistanceLevel) => (indexOf(a) >= indexOf(b) ? a : b);
/** Of two levels, the one giving more help. */
const moreHelp = (a: AssistanceLevel, b: AssistanceLevel) => (indexOf(a) <= indexOf(b) ? a : b);

/** The most help a step may *start* with in each mode (escalation can still go further). */
const MODE_CEILING: Record<Exclude<HodeMode, "agent">, AssistanceLevel> = { teach: "hint", help: "observe" };
/** Agent mode never offers less than this. */
const AGENT_FLOOR: AssistanceLevel = "guide";

/** Keeps a level inside the mode's range: teach challenges first, help waits, agent always guides. */
export function clampToMode(mode: HodeMode, level: AssistanceLevel): AssistanceLevel {
  return mode === "agent" ? moreHelp(level, AGENT_FLOOR) : quieter(level, MODE_CEILING[mode]);
}

/**
 * Where a step starts. A practised skill resumes at its saved level, within the mode's range; a new
 * skill starts at the mode's own starting point (agent: a full demonstration).
 */
export function startLevel(mode: HodeMode, record: SkillRecord | null): AssistanceLevel {
  if (!record) return mode === "agent" ? "demonstrate" : MODE_CEILING[mode];
  return clampToMode(mode, record.last_assistance_level);
}

/**
 * `startLevel`, moved at most one ladder step toward the level learning memory remembers, and kept
 * in the mode's range. A mastered skill record always wins: memory never adds help to it.
 */
export function nudgeStartLevel(mode: HodeMode, record: SkillRecord | null, remembered?: AssistanceLevel): AssistanceLevel {
  const base = startLevel(mode, record);
  const mastered = record?.status === "mastered" || record?.last_assistance_level === "independent";
  if (!remembered || mastered || remembered === base) return base;
  const nudged = indexOf(remembered) < indexOf(base) ? escalate(base) : relax(base);
  return clampToMode(mode, nudged);
}

/** Escalations already raised `outcome.level` during the step; an unaided completion earns one step less help. */
export function nextStoredLevel(outcome: StepOutcome): AssistanceLevel {
  return outcome.completed && !outcome.escalated ? relax(outcome.level) : outcome.level;
}

export function applyOutcome(previous: SkillRecord | null, skillId: string, outcome: StepOutcome, now: string): SkillRecord {
  const success_count = (previous?.success_count ?? 0) + (outcome.completed ? 1 : 0);
  const failure_count = (previous?.failure_count ?? 0) + outcome.mistakes;
  const attempts = success_count + failure_count;
  const level = nextStoredLevel(outcome);
  return {
    skill_id: skillId,
    status: level === "independent" ? "mastered" : "learning",
    confidence: attempts === 0 ? 0 : Math.round((success_count / attempts) * CONFIDENCE_DECIMALS) / CONFIDENCE_DECIMALS,
    success_count,
    failure_count,
    last_assistance_level: level,
    last_seen_at: now,
  };
}

export type ConfidenceBand = "precise" | "broad" | "uncertain";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_PRECISE) return "precise";
  if (confidence >= CONFIDENCE_BROAD) return "broad";
  return "uncertain";
}

type OverlayStyle = "full" | "highlight" | "none";

function overlayStyle(action: TeachingAction): OverlayStyle {
  switch (action.kind) {
    case "answer":
      return "highlight";
    case "clarify":
    case "complete":
      return "none";
    case "correct":
      return action.assistanceLevel === "demonstrate" ? "full" : "highlight";
    case "guide":
      if (action.assistanceLevel === "demonstrate") return "full";
      return action.assistanceLevel === "guide" ? "highlight" : "none";
  }
}

/** `nearby`: bounds of text around the target, so its label can keep clear of them. */
export function overlayFor(action: TeachingAction, pin?: Rect, nearby: Rect[] = []): OverlayPrimitive[] {
  const primitives: OverlayPrimitive[] = pin ? [{ kind: "pin", bounds: pin }] : [];
  const target = action.target;
  const style = overlayStyle(action);
  if (!target || style === "none") return primitives;
  const band = confidenceBand(target.confidence);
  if (band === "uncertain") return primitives;
  const keepClear = nearby.length > 0 ? { keepClear: nearby } : {};
  if (band === "broad") {
    primitives.push({ kind: "highlight", bounds: padRect(target.bounds, BROAD_PADDING_PX), label: target.label, emphasis: "broad", ...keepClear });
    return primitives;
  }
  if (style === "full") primitives.push({ kind: "spotlight", bounds: target.bounds });
  primitives.push({ kind: "highlight", bounds: target.bounds, label: target.label, emphasis: "precise", ...keepClear });
  if (style === "full") primitives.push({ kind: "arrow", to: target.bounds });
  return primitives;
}
