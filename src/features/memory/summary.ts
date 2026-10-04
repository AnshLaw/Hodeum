import type { HodeOutcome } from "../../data/types";
import { ASSISTANCE_LEVELS, type AssistanceLevel } from "../../lib/types";
import type { HodeLearningSummary } from "../../providers/interfaces";
import { currentStep, type HodeEvent, type HodeState } from "../hode/model";
import { relax } from "../hode/policy";

/** One step of a Hode as memory sees it: the pack's own words and ids, never the learner's. */
export interface StepTrace {
  skill: string;
  objective: string;
  /** The level the step ended at, after any escalation. */
  level: AssistanceLevel;
  /** A hint, a stuck timeout or a correction raised help during the step. */
  helped: boolean;
  done: boolean;
}

/** Below this level Hodey still shows or hints the way; from it on, the learner works unaided. */
const UNAIDED_FROM = ASSISTANCE_LEVELS.indexOf("observe");

function trace(state: HodeState, done: boolean): StepTrace | undefined {
  const step = currentStep(state);
  return step && { skill: step.skill, objective: step.objective, level: state.level, helped: state.escalated, done };
}

/** The step a learner action just completed, if this transition completed one. */
export function finishedStep(event: HodeEvent, prev: HodeState, next: HodeState): StepTrace | undefined {
  if (event.type !== "LEARNER_ACTED" || !prev.pack) return undefined;
  const advanced = next.stepIndex > prev.stepIndex || (next.phase === "success" && prev.phase !== "success");
  return advanced ? trace(prev, true) : undefined;
}

const independent = (step: StepTrace) => !step.helped && ASSISTANCE_LEVELS.indexOf(step.level) >= UNAIDED_FROM;

/** Like a skill record: a step done without help earns one step less help next time. */
const nextLevelOf = (step: StepTrace): AssistanceLevel => (step.done && !step.helped ? relax(step.level) : step.level);

function nextAssistanceLevel(steps: StepTrace[], fallback: AssistanceLevel): AssistanceLevel {
  if (steps.length === 0) return fallback;
  const most = Math.min(...steps.map((step) => ASSISTANCE_LEVELS.indexOf(nextLevelOf(step))));
  return ASSISTANCE_LEVELS[most];
}

const unique = (values: string[]) => [...new Set(values)];

/**
 * The compact end-of-Hode summary (PRD §18.1). `final` is the last state of the Hode: the success
 * state, or the state just before it was ended (whose current step was practised but not finished).
 */
export function summarize(final: HodeState, steps: StepTrace[], outcome: HodeOutcome): HodeLearningSummary {
  const unfinished = outcome === "ended" ? trace(final, false) : undefined;
  const all = unfinished ? [...steps, unfinished] : steps;
  const finished = steps.filter((step) => step.done);
  const unaided = finished.filter(independent).length;
  return {
    hode: final.pack?.title ?? final.goal,
    completed: outcome === "completed",
    skills_practiced: unique(all.map((step) => step.skill)),
    needed_help_with: unique(all.filter((step) => step.helped).map((step) => step.objective)),
    independent_steps: unaided,
    guided_steps: finished.length - unaided,
    preferred_language: final.language,
    next_assistance_level: nextAssistanceLevel(all, final.level),
  };
}
