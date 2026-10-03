import { COPY } from "../../lib/copy";
import { ASSISTANCE_LEVELS, type StepOutcome, type TaskStep } from "../../lib/types";
import { beginStep, requestReason } from "./flow";
import {
  MAX_WRONG_ACTIONS,
  STUCK_MS,
  currentStep,
  noop,
  pinOverlay,
  withLeadingEffects,
  type EventOf,
  type HodeEffect,
  type HodeState,
  type Transition,
} from "./model";
import { escalate } from "./policy";
import { becameTrue, evaluateSignal } from "./signals";

const CANCEL_TIMER: HodeEffect = { type: "cancelStuckTimer" };

function escalateState(s: HodeState, options: { correction?: string; countsAsMistake: boolean }): HodeState {
  return {
    ...s,
    level: escalate(s.level),
    escalated: true,
    mistakes: s.mistakes + (options.countsAsMistake ? 1 : 0),
    correction: options.correction,
    wrongActions: 0,
  };
}

function completeStep(s: HodeState, step: TaskStep): Transition {
  const outcome: StepOutcome = { completed: true, mistakes: s.mistakes, level: s.level, escalated: s.escalated };
  const learnedSkills = s.learnedSkills.includes(step.skill) ? s.learnedSkills : [...s.learnedSkills, step.skill];
  const done: HodeEffect[] = [CANCEL_TIMER, { type: "clearOverlay" }, { type: "recordOutcome", skillId: step.skill, outcome }];
  const finished = { ...s, learnedSkills };
  const nextIndex = s.stepIndex + 1;
  if (!s.pack || nextIndex >= s.pack.steps.length) {
    return {
      state: { ...finished, phase: "success", action: undefined },
      effects: [...done, { type: "say", text: COPY.hodeCompleteSpeech }],
    };
  }
  const unaided = !s.escalated && (s.level === "observe" || s.level === "independent");
  const praise: HodeEffect[] = unaided ? [{ type: "say", text: COPY.rememberedOnYourOwn }] : [];
  return withLeadingEffects(beginStep(finished, nextIndex), [...done, ...praise]);
}

/** Open-ended Hodes have no success signal to check, so every learner action asks the model what's next. */
function onOpenAction(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  return withLeadingEffects(requestReason({ ...s, observation: e.observation }), [CANCEL_TIMER]);
}

export function onLearnerActed(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  if (s.open && (s.phase === "guiding" || s.phase === "reasoning")) return onOpenAction(s, e);
  const step = currentStep(s);
  if ((s.phase !== "guiding" && s.phase !== "reasoning") || !step) return noop(s);
  const previous = s.observation;
  const next = { ...s, observation: e.observation };
  if (evaluateSignal(step.success, e.observation)) return completeStep(next, step);
  const mistake = step.mistakes.find((m) => becameTrue(m.signal, previous, e.observation));
  if (mistake) {
    const corrected = escalateState(next, { correction: mistake.correction, countsAsMistake: true });
    return withLeadingEffects(requestReason(corrected), [CANCEL_TIMER]);
  }
  const wrongActions = s.wrongActions + 1;
  if (wrongActions >= MAX_WRONG_ACTIONS) {
    return withLeadingEffects(requestReason(escalateState(next, { countsAsMistake: true })), [CANCEL_TIMER]);
  }
  // The newest learner action wins: re-reason so the in-flight result is dropped as stale.
  if (s.phase === "reasoning") return requestReason({ ...next, wrongActions });
  return { state: { ...next, wrongActions }, effects: [] };
}

export function onStuckTimeout(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  return requestReason(escalateState(s, { countsAsMistake: false }));
}

export function onHintRequested(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  return withLeadingEffects(requestReason(escalateState(s, { countsAsMistake: false })), [CANCEL_TIMER]);
}

export function onExplainRequested(s: HodeState): Transition {
  const step = currentStep(s);
  if (s.phase !== "guiding" || !step) return noop(s);
  return { state: { ...s, explanation: step.explain }, effects: [{ type: "say", text: step.explain }] };
}

export function onRepeat(s: HodeState): Transition {
  const speech = s.action?.speech ?? "";
  if ((s.phase !== "guiding" && s.phase !== "answering") || speech === "") return noop(s);
  return { state: s, effects: [{ type: "say", text: speech }] };
}

/** Fresh eyes on the current screen: drop the old observation and reason again. */
export function onLookAgain(s: HodeState): Transition {
  if (s.phase !== "guiding" && s.phase !== "recovering") return noop(s);
  return {
    state: { ...s, phase: "observing", reobserved: false, notice: undefined },
    effects: [CANCEL_TIMER, { type: "observe" }],
  };
}

export function onLetMeTry(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  const observeIndex = ASSISTANCE_LEVELS.indexOf("observe");
  const level = ASSISTANCE_LEVELS.indexOf(s.level) < observeIndex ? "observe" : s.level;
  return {
    state: { ...s, level },
    effects: [{ type: "stopSpeech" }, pinOverlay(s.focusRegion?.shape.bounds), { type: "startStuckTimer", ms: STUCK_MS }],
  };
}
