import { spoken } from "../../lib/spoken";
import { ASSISTANCE_LEVELS, type ActionVerdict, type ScreenObservation, type StepOutcome, type TaskStep, type TeachingAction } from "../../lib/types";
import { assessAction, mattered } from "./change";
import { beginStep, inWrongApp, onObserved, requestReason, waitForApp } from "./flow";
import { takeOver } from "./execute";
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
import { detectStuck, remember, stillShowing, type StuckSignal } from "./stuck";

const CANCEL_TIMER: HodeEffect = { type: "cancelStuckTimer" };
/** The top of the ladder: past it, Hodey explains why and restates the step (PRD §7). */
const MOST_HELP = ASSISTANCE_LEVELS[0];

function escalateState(s: HodeState, options: { correction?: string; countsAsMistake: boolean }): HodeState {
  return {
    ...s,
    ack: undefined,
    level: escalate(s.level),
    escalated: true,
    mistakes: s.mistakes + (options.countsAsMistake ? 1 : 0),
    correction: options.correction,
    wrongActions: 0,
  };
}

/** One rung up the PRD ladder; already at the top, a short explanation and a reset of the step. */
function raiseHelp(s: HodeState, options: { correction?: string; countsAsMistake: boolean; stuck?: StuckSignal }): HodeState {
  const step = currentStep(s);
  const atTop = s.level === MOST_HELP && step !== undefined;
  const reset = atTop ? [options.correction ?? step.explain, options.correction ? step.explain : step.speech.demonstrate].join(" ") : undefined;
  const raised = escalateState(s, { correction: reset ?? options.correction, countsAsMistake: options.countsAsMistake });
  return { ...raised, stuck: options.stuck ?? s.stuck };
}

function stuckLine(s: HodeState, signal: StuckSignal): string | undefined {
  const words = spoken(s.language);
  switch (signal.kind) {
    case "repeated_click":
      return words.repeatedClick(signal.control);
    case "menu_loop":
      return words.menuLoop(signal.menu);
    case "undo_loop":
      return words.undoLoop;
    case "surprise_dialog":
      return words.surpriseDialog(signal.title);
    case "target_missing":
      return words.targetMissing(signal.target);
    case "said_stuck":
      return undefined;
  }
}

/** An unexpected dialog is in the way: say how to get rid of it instead of pointing at a hidden target. */
function showRecovery(s: HodeState, step: TaskStep, signal: Extract<StuckSignal, { kind: "surprise_dialog" }>): Transition {
  const speech = stuckLine(s, signal) ?? "";
  const action: TeachingAction = { kind: "correct", speech, skill: step.skill, assistanceLevel: s.level };
  return {
    state: { ...s, phase: "guiding", action, surprise: signal.title, stuck: signal, stepActions: [] },
    effects: [CANCEL_TIMER, { type: "clearOverlay" }, { type: "say", text: speech }, { type: "startStuckTimer", ms: STUCK_MS }],
  };
}

const WRONG_ACTION_SIGNALS: StuckSignal["kind"][] = ["repeated_click", "menu_loop"];

function onStuckSignal(s: HodeState, step: TaskStep, signal: StuckSignal): Transition {
  if (signal.kind === "surprise_dialog") return showRecovery(s, step, signal);
  const countsAsMistake = WRONG_ACTION_SIGNALS.includes(signal.kind);
  const raised = raiseHelp({ ...s, stepActions: [] }, { correction: stuckLine(s, signal), countsAsMistake, stuck: signal });
  return withLeadingEffects(requestReason(raised), [CANCEL_TIMER]);
}

/** Guidance waits while the surprise dialog is open and picks up once it's closed. */
function afterSurprise(s: HodeState, surprise: string): Transition {
  if (s.observation && stillShowing(s.observation, surprise)) return { state: s, effects: [] };
  return withLeadingEffects(requestReason({ ...s, surprise: undefined }), [CANCEL_TIMER]);
}

/** Nothing that matters changed: guidance (or the reasoning in flight) still fits the screen. */
const quiet = (s: HodeState): Transition => ({ state: s, effects: [] });

/** The target came into view or moved: point at it again, without counting a wrong action. */
function repoint(s: HodeState): Transition {
  return withLeadingEffects(requestReason({ ...s, repointing: true }), [CANCEL_TIMER]);
}

/** The action didn't finish the step and wasn't a known mistake: stuck, re-point, nothing, or one more try. */
function onUnfinishedAction(s: HodeState, step: TaskStep, wasReasoning: boolean, verdict: ActionVerdict): Transition {
  if (s.surprise) return afterSurprise(s, s.surprise);
  const signal = detectStuck(s.stepActions, step, s.pack);
  if (signal) return onStuckSignal(s, step, signal);
  if (verdict === "progress") return repoint(s);
  if (!mattered(verdict)) return quiet(s);
  const wrongActions = s.wrongActions + 1;
  if (wrongActions >= MAX_WRONG_ACTIONS) {
    return withLeadingEffects(requestReason(escalateState(s, { countsAsMistake: true })), [CANCEL_TIMER]);
  }
  // The newest learner action wins: re-reason so the in-flight result is dropped as stale.
  if (wasReasoning) return requestReason({ ...s, wrongActions });
  return { state: { ...s, wrongActions }, effects: [] };
}

/**
 * A short "that's right" for a step just done: always in Teach (a remembered step gets its own line),
 * in Help only when Hodey stepped in on it, and a lighter one in Agent. Never the same phrase twice running.
 */
export function acknowledgement(s: HodeState): string | undefined {
  if (s.mode === "help" && !s.escalated) return undefined;
  const words = spoken(s.language);
  const unaided = s.mode === "teach" && !s.escalated && (s.level === "observe" || s.level === "independent");
  if (unaided && s.lastAck !== words.rememberedOnYourOwn) return words.rememberedOnYourOwn;
  const pool = (s.mode === "agent" ? words.stepDoneLight : words.stepDone).filter((line) => line !== s.lastAck);
  return pool[s.stepIndex % pool.length];
}

function completeStep(s: HodeState, step: TaskStep): Transition {
  const outcome: StepOutcome = { completed: true, mistakes: s.mistakes, level: s.level, escalated: s.escalated };
  const learnedSkills = s.learnedSkills.includes(step.skill) ? s.learnedSkills : [...s.learnedSkills, step.skill];
  const done: HodeEffect[] = [CANCEL_TIMER, { type: "clearOverlay" }, { type: "recordOutcome", skillId: step.skill, outcome }];
  const finished: HodeState = { ...s, learnedSkills, ack: undefined, pendingAck: undefined };
  const nextIndex = s.stepIndex + 1;
  if (!s.pack || nextIndex >= s.pack.steps.length) {
    return {
      state: { ...finished, phase: "success", action: undefined },
      effects: [...done, { type: "say", text: spoken(s.language).hodeCompleteSpeech }],
    };
  }
  // Said with the next step's guidance, so the next instruction doesn't cut the acknowledgement off.
  const ack = acknowledgement(s);
  const acknowledged: HodeState = ack ? { ...finished, pendingAck: ack, lastAck: ack } : finished;
  return withLeadingEffects(beginStep(acknowledged, nextIndex), done);
}

/** Open-ended Hodes have no success signal to check, so every action that changed something asks the model what's next. */
function onOpenAction(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  if (inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  const next: HodeState = { ...s, observation: e.observation, waitingForApp: undefined };
  if (!s.waitingForApp && !mattered(assessAction({ before: s.observation, after: e.observation }))) return quiet(next);
  return withLeadingEffects(requestReason(next), [CANCEL_TIMER]);
}

/** A lesson step being prepared (skill loading, screen being read), not a question being answered. */
const preparingStep = (s: HodeState): boolean => s.phase === "observing" && !s.open && s.spokenQuestion === undefined && s.question === undefined;

const newer = (a: ScreenObservation | undefined, b: ScreenObservation): ScreenObservation => (a && a.at > b.at ? a : b);

/**
 * The screen read for a new step. A learner who already did the step (often one who knows it well)
 * acted while Hodey was preparing it: count the newest screen, not a read that started before the click.
 */
export function onObservedStep(s: HodeState, e: EventOf<"OBSERVED">): Transition {
  const step = currentStep(s);
  if (!preparingStep(s) || !step) return onObserved(s, e);
  const observation = newer(s.observation, e.observation);
  // Only a learner action finishes a step here: a screen that already met the goal still gets taught.
  const acted = s.actedWhilePreparing === true;
  if (acted && !inWrongApp(s, observation) && evaluateSignal(step.success, observation)) return completeStep({ ...s, observation }, step);
  return onObserved(s, { ...e, observation });
}

export function onLearnerActed(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  // Keep a click made while the step is being prepared; the screen read for the step counts it.
  if (preparingStep(s) && currentStep(s)) return { state: { ...s, observation: newer(s.observation, e.observation), actedWhilePreparing: true }, effects: [] };
  if (s.open && (s.phase === "guiding" || s.phase === "reasoning")) return onOpenAction(s, e);
  const step = currentStep(s);
  if ((s.phase !== "guiding" && s.phase !== "reasoning") || !step) return noop(s);
  if (inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  if (s.waitingForApp) return requestReason({ ...s, observation: e.observation, waitingForApp: undefined });
  const previous = s.observation;
  const action = { before: previous, after: e.observation };
  const verdict = assessAction(action, step);
  const stepActions = remember(s.stepActions, action);
  // Something that matters happened: the stuck timer's reset at the most help may be given again.
  const toppedOut = s.toppedOut === true && !mattered(verdict);
  const next: HodeState = { ...s, observation: e.observation, stepActions, ack: undefined, toppedOut };
  if (evaluateSignal(step.success, e.observation)) return completeStep(next, step);
  const mistake = step.mistakes.find((m) => becameTrue(m.signal, previous, e.observation));
  if (mistake) {
    const corrected = escalateState(next, { correction: mistake.correction, countsAsMistake: true });
    return withLeadingEffects(requestReason(corrected), [CANCEL_TIMER]);
  }
  // On the phone, screen changes are mostly navigation (scrolling, going back), not mistakes; known
  // mistakes are caught above and hesitation by the stuck timer. Re-locate so the highlight follows.
  if (s.pack?.surface === "phone") return mattered(verdict) ? repoint(next) : quiet(next);
  return onUnfinishedAction(next, step, s.phase === "reasoning", verdict);
}

/**
 * Hesitation raises help one rung per timeout. At the most help the step is explained and reset once;
 * after that Hodey waits for the learner (an action that matters, or a hint request) instead of
 * re-deciding and repeating itself every few seconds while they look around.
 */
export function onStuckTimeout(s: HodeState): Transition {
  if (s.phase !== "guiding" || s.toppedOut) return noop(s);
  const toppedOut = s.level === MOST_HELP && currentStep(s) !== undefined;
  return requestReason(raiseHelp({ ...s, toppedOut }, { countsAsMistake: false }));
}

export function onHintRequested(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  return withLeadingEffects(requestReason(raiseHelp(s, { countsAsMistake: false })), [CANCEL_TIMER]);
}

/** "Where?", "I don't see it": the same ladder as the stuck timer, never a pause. */
export function onSaidStuck(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  const raised = raiseHelp(s, { countsAsMistake: false, stuck: { kind: "said_stuck" } });
  return withLeadingEffects(requestReason(raised), [CANCEL_TIMER]);
}

export function onExplainRequested(s: HodeState): Transition {
  const step = currentStep(s);
  if (s.phase !== "guiding" || !step) return noop(s);
  return { state: { ...s, explanation: step.explain }, effects: [{ type: "say", text: step.explain }] };
}

export function onRepeat(s: HodeState): Transition {
  const speech = s.action?.speech ?? "";
  if ((s.phase !== "guiding" && s.phase !== "answering") || speech === "") return noop(s);
  // A repeated answer is said again before it folds away.
  const state = s.phase === "answering" ? { ...s, answerSaid: false } : s;
  return { state, effects: [{ type: "say", text: speech }] };
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
  if (s.phase === "acting" || s.phase === "checkpoint") return takeOver(s);
  if (s.phase !== "guiding") return noop(s);
  const observeIndex = ASSISTANCE_LEVELS.indexOf("observe");
  const level = ASSISTANCE_LEVELS.indexOf(s.level) < observeIndex ? "observe" : s.level;
  return {
    state: { ...s, level },
    effects: [{ type: "stopSpeech" }, pinOverlay(s.focusRegion), { type: "startStuckTimer", ms: STUCK_MS }],
  };
}
