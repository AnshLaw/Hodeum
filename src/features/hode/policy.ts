import { padRect } from "../../lib/coords";
import {
  ASSISTANCE_LEVELS,
  type AssistanceLevel,
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

/** A practised skill resumes where it left off; a new one starts at the learner's chosen preset. */
export function startingLevel(record: SkillRecord | null, fallback: AssistanceLevel = "demonstrate"): AssistanceLevel {
  return record?.last_assistance_level ?? fallback;
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

export function overlayFor(action: TeachingAction, pin?: Rect): OverlayPrimitive[] {
  const primitives: OverlayPrimitive[] = pin ? [{ kind: "pin", bounds: pin }] : [];
  const target = action.target;
  const style = overlayStyle(action);
  if (!target || style === "none") return primitives;
  const band = confidenceBand(target.confidence);
  if (band === "uncertain") return primitives;
  if (band === "broad") {
    primitives.push({ kind: "highlight", bounds: padRect(target.bounds, BROAD_PADDING_PX), label: target.label, emphasis: "broad" });
    return primitives;
  }
  if (style === "full") primitives.push({ kind: "spotlight", bounds: target.bounds });
  primitives.push({ kind: "highlight", bounds: target.bounds, label: target.label, emphasis: "precise" });
  if (style === "full") primitives.push({ kind: "arrow", to: target.bounds });
  return primitives;
}
