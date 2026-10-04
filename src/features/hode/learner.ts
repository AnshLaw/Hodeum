import { spoken } from "../../lib/spoken";
import { ASSISTANCE_LEVELS, type ActionVerdict, type ScreenObservation, type StepOutcome, type TaskStep, type TeachingAction } from "../../lib/types";
import { assessAction, mattered } from "./change";
import { beginStep, inWrongApp, onObserved, onSkillLoaded, openedApp, overlayOf, requestReason, waitForApp } from "./flow";
import { takeOver } from "./execute";
import { acknowledgement, watchedOnly } from "./ack";
import { onVoiceQuestion } from "./session";
import { finishHode } from "./closing";
import {
  MAX_WRONG_ACTIONS,
  STUCK_MS,
  currentStep,
  noop,
  pinOverlay,
  standingBy,
  withLeadingEffects,
  type EventOf,
  type HodeEffect,
  type HodeState,
  type Transition,
} from "./model";
import { escalate } from "./policy";
import { becameTrue, evaluateSignal, findByNames } from "./signals";
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
    neededHelp: true,
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
  return withLeadingEffects(requestReason(s), [CANCEL_TIMER]);
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

export { acknowledgement } from "./ack";

/** Teach confirms a step the learner needed help with by the idea behind it, unless that was said this step. */
const reasonFor = (s: HodeState, step: TaskStep): string | undefined => (s.mode === "teach" && s.whySaid !== true && !watchedOnly(s) ? step.explain : undefined);

function completeStep(s: HodeState, step: TaskStep): Transition {
  const outcome: StepOutcome = { completed: true, mistakes: s.mistakes, level: s.level, escalated: s.escalated };
  const learnedSkills = s.learnedSkills.includes(step.skill) ? s.learnedSkills : [...s.learnedSkills, step.skill];
  const done: HodeEffect[] = [CANCEL_TIMER, { type: "clearOverlay" }, { type: "recordOutcome", skillId: step.skill, outcome }];
  const finished: HodeState = { ...s, learnedSkills, ack: undefined, pendingAck: undefined, reason: undefined, pendingReason: undefined };
  const nextIndex = s.stepIndex + 1;
  if (!s.pack || nextIndex >= s.pack.steps.length) return withLeadingEffects(finishHode(finished), done);
  // Said with the next step's guidance, so the next instruction doesn't cut the acknowledgement off.
  const ack = acknowledgement(s);
  const acknowledged: HodeState = ack ? { ...finished, pendingAck: ack, lastAck: ack, pendingReason: reasonFor(s, step) } : finished;
  return withLeadingEffects(beginStep({ ...acknowledged, freshRead: true }, nextIndex), done);
}

/**
 * Open-ended Hodes have no success signal to check, so an action that changed something asks the model
 * what's next (it says whether the step was done by moving on). Help only watches until asked or stuck.
 */
function onOpenAction(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  if (inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  if (s.openingApp) return openedApp({ ...s, observation: e.observation });
  const action = { before: s.observation, after: e.observation };
  const next: HodeState = { ...s, observation: e.observation, waitingForApp: undefined, stepActions: remember(s.stepActions, action), ack: undefined };
  if (!s.waitingForApp && !mattered(assessAction(action))) return quiet(next);
  // Acting is the opposite of being stuck: Help keeps watching, with the stuck timer started afresh.
  if (standingBy(next)) return { state: next, effects: [CANCEL_TIMER, { type: "startStuckTimer", ms: STUCK_MS }] };
  // Something that matters happened (or they're back in the app): the stuck timer may climb the ladder again.
  const asked: HodeState = { ...next, toppedOut: false, actedSinceInstruction: true, prompted: s.waitingForApp !== undefined };
  return withLeadingEffects(requestReason(asked), [CANCEL_TIMER]);
}

/** A lesson step being prepared (skill loading, screen being read), not a question being answered. */
const preparingStep = (s: HodeState): boolean => s.phase === "observing" && !s.open && s.spokenQuestion === undefined && s.question === undefined;

const newer = (a: ScreenObservation | undefined, b: ScreenObservation): ScreenObservation => (a && a.at > b.at ? a : b);

/**
 * A step's skill is loaded. The read that finished the last step was taken a moment ago: when it
 * already shows this step's control, the step starts from it instead of waiting on another read.
 */
export function onSkillLoadedStep(s: HodeState, e: EventOf<"SKILL_LOADED">): Transition {
  const loaded = onSkillLoaded(s, e);
  const step = currentStep(loaded.state);
  const read = s.freshRead === true ? s.observation : undefined;
  if (loaded.state === s || !step || !read || findByNames(read.elements, step.target.names).length === 0) return loaded;
  return onObservedStep(loaded.state, { type: "OBSERVED", observation: read });
}

/**
 * The screen read for a new step. A learner who already did the step (often one who knows it well)
 * acted while Hodey was preparing it: count the newest screen, not a read that started before the click.
 */
export function onObservedStep(s: HodeState, e: EventOf<"OBSERVED">): Transition {
  const step = currentStep(s);
  if (!preparingStep(s) || !step) return onObserved(s, e);
  const observation = newer(s.observation, e.observation);
  // Only a learner action (or their word that they did it) finishes a step here: a screen that already met the goal still gets taught.
  const acted = s.actedWhilePreparing === true || s.claimedDone === true;
  if (acted && !inWrongApp(s, observation) && evaluateSignal(step.success, observation)) return completeStep({ ...s, observation, claimedDone: false, movingOn: false }, step);
  if (!s.claimedDone) return onObserved(s, { ...e, observation });
  // Next: the learner moves on even when the screen doesn't show the step done (it isn't counted as learned).
  if (s.movingOn) return onSkipStep({ ...s, observation, claimedDone: false, movingOn: false });
  // They said they did it, but the screen doesn't show it: say so, and let them skip ahead.
  const missed: HodeState = { ...s, claimedDone: false, offerSkip: true, pendingNote: spoken(s.language).cantSeeItDone };
  return onObserved(missed, { ...e, observation });
}

export function onLearnerActed(s: HodeState, e: EventOf<"LEARNER_ACTED">): Transition {
  // Keep a click made while the step is being prepared; the screen read for the step counts it.
  if (preparingStep(s) && currentStep(s)) return { state: { ...s, observation: newer(s.observation, e.observation), actedWhilePreparing: true }, effects: [] };
  if (s.open && (s.phase === "guiding" || s.phase === "reasoning")) return onOpenAction(s, e);
  const step = currentStep(s);
  if ((s.phase !== "guiding" && s.phase !== "reasoning") || !step) return noop(s);
  if (inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  // Back in the app after Hodey asked them to switch: the step's instruction is said again.
  if (s.waitingForApp) return requestReason({ ...s, observation: e.observation, waitingForApp: undefined, shellPending: false, prompted: true });
  const previous = s.observation;
  const action = { before: previous, after: e.observation };
  const verdict = assessAction(action, step);
  const stepActions = remember(s.stepActions, action);
  // Something that matters happened: the stuck timer's reset at the most help may be given again.
  const toppedOut = s.toppedOut === true && !mattered(verdict);
  const next: HodeState = { ...s, observation: e.observation, stepActions, ack: undefined, reason: undefined, toppedOut };
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
 * Teach's hint rung has two beats: the question alone while the learner tries, then (stuck, a hint
 * asked for, "where?") the area that holds the answer, at once and without a model call. Undefined when
 * that beat is past, or there's no area to light (then help climbs a rung as usual).
 */
function revealArea(s: HodeState, stuck?: StuckSignal): Transition | undefined {
  if (s.mode !== "teach" || s.level !== "hint" || s.areaShown === true || !s.action?.target) return undefined;
  // Lighting the area is help, and why the learner needed it ("where?") goes into their history.
  const shown: HodeState = { ...s, areaShown: true, escalated: true, neededHelp: true, stuck: stuck ?? s.stuck };
  const primitives = overlayOf(shown, s.action);
  if (primitives.length === 0) return undefined;
  const effects: HodeEffect[] = [CANCEL_TIMER, { type: "renderOverlay", primitives }, { type: "say", text: spoken(s.language).lookHere }, { type: "startStuckTimer", ms: STUCK_MS }];
  return { state: shown, effects };
}

/**
 * Hesitation raises help one rung per timeout. At the most help a step is explained and reset once (an
 * open-ended Hode gets one fresh look); after that Hodey waits for the learner (an action that
 * matters, or a hint request) instead of re-deciding and repeating itself while they look around.
 */
export function onStuckTimeout(s: HodeState): Transition {
  // In another app, the learner isn't hesitating over the step.
  if (s.phase !== "guiding" || s.toppedOut || s.away === true) return noop(s);
  const area = revealArea(s);
  if (area) return area;
  return requestReason(raiseHelp({ ...s, toppedOut: s.level === MOST_HELP }, { countsAsMistake: false }));
}

export function onHintRequested(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  const area = revealArea(s);
  if (area) return area;
  return withLeadingEffects(requestReason(raiseHelp({ ...s, prompted: true }, { countsAsMistake: false })), [CANCEL_TIMER]);
}

/** "Show me": the learner asked for the answer, so the step is demonstrated in full (and won't count as done unaided). */
export function onShowMe(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  const shown: HodeState = { ...s, level: MOST_HELP, escalated: true, neededHelp: true, prompted: true, toppedOut: false };
  return withLeadingEffects(requestReason(shown), [CANCEL_TIMER]);
}

/** "Where?", "I don't see it": the same ladder as the stuck timer, never a pause. */
export function onSaidStuck(s: HodeState): Transition {
  if (s.phase !== "guiding") return noop(s);
  const area = revealArea(s, { kind: "said_stuck" });
  if (area) return area;
  const raised = raiseHelp({ ...s, prompted: true }, { countsAsMistake: false, stuck: { kind: "said_stuck" } });
  return withLeadingEffects(requestReason(raised), [CANCEL_TIMER]);
}

export function onExplainRequested(s: HodeState): Transition {
  // An open-ended Hode has no written why: Hodey asks the model, as a question about the screen.
  if (s.open && s.phase === "guiding" && s.action) return onVoiceQuestion(s, { type: "VOICE_QUESTION", question: spoken(s.language).whyThisStep });
  const step = currentStep(s);
  if (s.phase !== "guiding" || !step) return noop(s);
  return { state: { ...s, explanation: step.explain, whySaid: true }, effects: [{ type: "say", text: step.explain }] };
}

export function onRepeat(s: HodeState): Transition {
  const speech = s.action?.speech ?? "";
  if ((s.phase !== "guiding" && s.phase !== "answering") || speech === "") return noop(s);
  // A repeated answer is said again before it folds away.
  const state = s.phase === "answering" ? { ...s, answerSaid: false } : s;
  return { state, effects: [{ type: "say", text: speech }] };
}

/**
 * Fresh eyes on the current screen: drop the old observation and reason again. "I did it" and Look
 * again also check whether the step is done; a look prompted by switching back to the app doesn't.
 */
export function onLookAgain(s: HodeState): Transition {
  if (s.phase !== "guiding" && s.phase !== "recovering") return noop(s);
  const claimedDone = s.waitingForApp === undefined && currentStep(s) !== undefined;
  return {
    state: { ...s, phase: "observing", reobserved: false, notice: undefined, prompted: true, claimedDone },
    effects: [CANCEL_TIMER, { type: "observe" }],
  };
}

/**
 * Another window came forward. Waiting for the learner's app, Hodey looks again; in an open-ended Hode
 * it's worth a fresh look (the learner may have opened the app the goal is in). A lesson ignores it: its
 * steps are checked on the learner's next action, and a glance elsewhere isn't a step.
 */
export function onAppSwitched(s: HodeState, e: EventOf<"APP_SWITCHED">): Transition {
  if (e.away === true) return steppedAway(s);
  if (e.away === false && s.away === true) return cameBack(s);
  if (s.phase === "idle" || s.phase === "goal_entry") return settledNotice(s);
  if (s.phase !== "guiding") return noop(s);
  // The ring on the taskbar's search box has done its job once another window comes forward.
  if (s.waitingForApp) return withLeadingEffects(onLookAgain(s), [{ type: "clearOverlay" }]);
  if (!s.open) return noop(s);
  // A fresh look, but not an action of the learner's: a glance at another app never counts a step as done.
  return { state: { ...s, phase: "observing", reobserved: false, toppedOut: false }, effects: [CANCEL_TIMER, { type: "observe" }] };
}

/** Hodey asked where the learner is working, and their pointer came to rest somewhere new: look again, with it. */
export function onPointerRested(s: HodeState): Transition {
  if (s.phase !== "guiding" || s.action?.kind !== "clarify" || s.waitingForApp !== undefined || s.away === true) return noop(s);
  return { state: { ...s, phase: "observing", reobserved: false }, effects: [CANCEL_TIMER, { type: "observe" }] };
}

/**
 * With no Hode running, a notice answers the learner's last words ("Opening Settings…"): once another window
 * comes forward it's done, and left up it would greet them at the next hover. A question still waiting for an
 * answer (which Outlook?) stays.
 */
function settledNotice(s: HodeState): Transition {
  if (s.notice === undefined || s.appChoice !== undefined) return noop(s);
  return { state: { ...s, notice: undefined }, effects: [] };
}

/** Phases of a running Hode the learner can step away from. */
const AWAY_PHASES: HodeState["phase"][] = ["guiding", "reasoning", "observing", "answering"];

/** In another app, the Hode's window still open behind it: the step and its card stay, quietly, with no stuck timer. */
function steppedAway(s: HodeState): Transition {
  if (s.away === true || !AWAY_PHASES.includes(s.phase)) return noop(s);
  return { state: { ...s, away: true }, effects: [CANCEL_TIMER] };
}

/** Back in the Hode's window: a fresh look at it (what changed while they were away), then the step carries on. */
function cameBack(s: HodeState): Transition {
  const back: HodeState = { ...s, away: false };
  if (s.phase !== "guiding") return { state: back, effects: [] };
  // A click made as they came back, before the window watcher settled, wasn't read: the lesson's fresh look
  // credits what it did (an open goal's step is the model's to judge, and a glance away never counts).
  const credited = s.open ? {} : { actedWhilePreparing: true };
  return { state: { ...back, ...credited, phase: "observing", reobserved: false }, effects: [CANCEL_TIMER, { type: "observe" }] };
}

/** Phases a Next can move on from: a step showing, or Hodey working out its help. */
const NEXT_PHASES: HodeState["phase"][] = ["guiding", "reasoning"];

/**
 * "Next": the learner has done what Hodey asked and wants to move on. A lesson takes one fresh look, so a step
 * that shows done is confirmed (and praised) as usual, and one that doesn't is moved past. An open goal counts
 * the instruction done and asks the model for the step after it.
 */
export function onNextStep(s: HodeState): Transition {
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (asking || !NEXT_PHASES.includes(s.phase) || !s.action) return noop(s);
  const effects: HodeEffect[] = [{ type: "stopSpeech" }, CANCEL_TIMER, { type: "observe" }];
  const looking: HodeState = { ...s, phase: "observing", reobserved: false };
  if (s.open) return { state: { ...looking, openDone: withDone(s.openDone, s.instructionSaid ?? s.action.speech), actedSinceInstruction: false }, effects };
  if (!currentStep(s)) return noop(s);
  return { state: { ...looking, claimedDone: true, movingOn: true }, effects };
}

function withDone(done: string[] | undefined, instruction: string): string[] {
  const list = done ?? [];
  return instruction === "" || list.at(-1) === instruction ? list : [...list, instruction];
}

/** Lesson phases a step can be skipped from (a question being answered isn't one). */
const SKIPPABLE: HodeState["phase"][] = ["guiding", "reasoning", "observing"];

/** "Skip": past a step Hodey couldn't see done. It isn't the learner's skill: nothing is learned, failed or relaxed. */
export function onSkipStep(s: HodeState): Transition {
  const step = currentStep(s);
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (!step || s.open || asking || !SKIPPABLE.includes(s.phase)) return noop(s);
  const moved: HodeState = { ...s, ack: undefined, pendingAck: undefined, reason: undefined, pendingReason: undefined, pendingNote: undefined };
  const done: HodeEffect[] = [{ type: "stopSpeech" }, CANCEL_TIMER, { type: "clearOverlay" }];
  const nextIndex = s.stepIndex + 1;
  if (!s.pack || nextIndex >= s.pack.steps.length) return withLeadingEffects(finishHode(moved), done);
  return withLeadingEffects(beginStep(moved, nextIndex), done);
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
