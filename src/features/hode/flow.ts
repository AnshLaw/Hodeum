import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import { localizePack } from "../../task-packs/localize";
import { area, padRect } from "../../lib/coords";
import type { AssistanceLevel, HodeMode, LearnerAnnotation, ScreenObservation, TeachingAction, TeachingContext } from "../../lib/types";
import {
  QUESTION_PADDING_PX,
  STUCK_MS,
  currentStep,
  initialState,
  noop,
  pinFor,
  type EventOf,
  type HodeEffect,
  type HodeState,
  type Transition,
} from "./model";
import { summarizeActions } from "./change";
import { neighboursOf } from "./neighbours";
import { confidenceBand, nudgeStartLevel, overlayFor } from "./policy";

/** Open-ended Hodes have no saved skill: the vision model phrases each step at the mode's level. */
const OPEN_START: Record<HodeMode, AssistanceLevel> = { teach: "hint", help: "observe", agent: "guide" };

export function onStartHode(s: HodeState): Transition {
  if (s.phase !== "idle") return noop(s);
  return { state: { ...initialState, phase: "goal_entry", focusRegion: s.focusRegion, language: s.language }, effects: [] };
}

export function onGoalSubmitted(s: HodeState, e: EventOf<"GOAL_SUBMITTED">): Transition {
  const goal = e.goal.trim();
  if (s.phase !== "goal_entry" || goal === "") return noop(s);
  const mode = e.mode ?? s.mode;
  const agentStyle = e.agentStyle ?? s.agentStyle;
  if (!e.pack && e.openAllowed) {
    const focus: HodeEffect[] = e.app ? [{ type: "focusApp", app: e.app }] : [];
    const level = OPEN_START[mode];
    return { state: { ...s, goal, app: e.app, mode, agentStyle, open: true, level, notice: undefined, phase: "observing" }, effects: [...focus, { type: "observe" }] };
  }
  const { noPack } = spoken(s.language);
  if (!e.pack) return { state: { ...s, goal, notice: noPack }, effects: [{ type: "say", text: noPack }] };
  // Bring the pack's app forward first, so Hodey reads Excel rather than whatever had focus.
  const pack = localizePack(e.pack, s.language);
  const begun = beginStep({ ...s, goal, mode, agentStyle, pack, app: pack.app, notice: undefined }, 0);
  // Agent mode gets going on its own: it opens the app and the pack's practice file instead of asking the learner to.
  const launch = mode === "agent" && e.pack.launch ? { launch: e.pack.launch } : {};
  return { ...begun, effects: [{ type: "focusApp", app: e.pack.app, ...launch }, ...begun.effects] };
}

/** Same app, ignoring case. An unknown app name (unreadable process) never blocks guidance. */
export function sameApp(observed: string, expected: string): boolean {
  return observed === "" || observed.toLowerCase() === expected.toLowerCase();
}

/** The learner is in another app: say so and point at nothing until they're back. */
export function waitForApp(s: HodeState, observation: ScreenObservation): Transition {
  const app = s.app ?? "";
  const words = spoken(s.language);
  const speech = s.pack?.surface === "phone" ? words.connectPhone : words.switchToApp(app);
  const action: TeachingAction = { kind: "clarify", speech, skill: currentStep(s)?.skill ?? "", assistanceLevel: s.level };
  // Already said: a fresh look that still finds another app keeps the waiting card, quietly.
  if (s.waitingForApp === app) return { state: { ...s, phase: "guiding", observation }, effects: [] };
  const effects: HodeEffect[] = [{ type: "clearOverlay" }, { type: "cancelStuckTimer" }, { type: "say", text: speech }];
  return { state: { ...s, phase: "guiding", observation, action, waitingForApp: app }, effects };
}

export function inWrongApp(s: HodeState, observation: ScreenObservation): boolean {
  return s.app !== undefined && !sameApp(observation.app, s.app);
}

export function beginStep(s: HodeState, stepIndex: number): Transition {
  const step = s.pack?.steps[stepIndex];
  if (!step) return noop(s);
  return {
    state: {
      ...s,
      phase: "observing",
      stepIndex,
      escalated: false,
      mistakes: 0,
      wrongActions: 0,
      action: undefined,
      correction: undefined,
      explanation: undefined,
      reobserved: false,
      stepActions: [],
      stuck: undefined,
      surprise: undefined,
      actedWhilePreparing: false,
      handedBack: false,
      hodeyTries: 0,
      instructionSaid: undefined,
      prompted: false,
      toppedOut: false,
    },
    effects: [{ type: "loadSkill", skillId: step.skill }],
  };
}

export function onSkillLoaded(s: HodeState, e: EventOf<"SKILL_LOADED">): Transition {
  if (s.phase !== "observing" || currentStep(s)?.skill !== e.skillId) return noop(s);
  // Memory nudges a skill's first step in a Hode only; later steps follow this Hode's own record.
  const remembered = s.learnedSkills.includes(e.skillId) ? undefined : e.remembered;
  return { state: { ...s, level: nudgeStartLevel(s.mode, e.record, remembered) }, effects: [{ type: "observe" }] };
}

export function onObserved(s: HodeState, e: EventOf<"OBSERVED">): Transition {
  if (s.phase !== "observing") return noop(s);
  // A question is answered wherever the learner is looking; only guidance waits for the right app.
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (!asking && inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  return requestReason({ ...s, observation: e.observation, waitingForApp: asking ? s.waitingForApp : undefined });
}

function contextFor(s: HodeState, observation: ScreenObservation): TeachingContext {
  return {
    goal: s.goal,
    pack: s.pack,
    step: currentStep(s),
    observation,
    assistanceLevel: s.level,
    utterance: s.question?.question ?? s.spokenQuestion,
    focusRegion: s.question ?? s.focusRegion,
    correction: s.correction,
    recentMistakes: s.mistakes,
    openGoal: s.open,
    lastInstruction: s.open ? s.action?.speech : undefined,
    language: s.language,
    recentActions: summarizeActions(s.stepActions, currentStep(s)),
  };
}

export function requestReason(s: HodeState): Transition {
  if (!s.observation) return { state: { ...s, phase: "observing" }, effects: [{ type: "observe" }] };
  const requestId = s.requestId + 1;
  return {
    state: { ...s, phase: "reasoning", requestId, thinking: false },
    effects: [{ type: "reason", requestId, context: contextFor(s, s.observation) }],
  };
}

/** The running request reached the vision model or the cloud; a stale request's news is dropped. */
export function onThinking(s: HodeState, e: EventOf<"THINKING">): Transition {
  if (s.phase !== "reasoning" || e.requestId !== s.requestId || s.thinking) return noop(s);
  return { state: { ...s, thinking: true }, effects: [] };
}

export function onActionReady(s: HodeState, e: EventOf<"ACTION_READY">): Transition {
  if (s.phase !== "reasoning" || e.requestId !== s.requestId) return noop(s);
  const withNotice = { ...s, notice: e.failures.length > 0 ? COPY.fallbackNotice : s.notice };
  const action = e.action;
  // Whatever form a reply to a question takes, it's shown as the answer, so the question never lingers.
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (action.kind === "answer" || (asking && action.kind !== "complete")) return showAnswer(withNotice, { ...action, kind: "answer" });
  if (action.kind === "complete" && s.open) return finishOpenHode(withNotice, action);
  const band = action.target ? confidenceBand(action.target.confidence) : "uncertain";
  // A correction is worth saying even when its target isn't on screen (the learner left the page).
  if (band === "uncertain" && action.kind === "correct") return showGuidance(withNotice, { ...action, target: undefined });
  if (band === "uncertain" && !s.reobserved) {
    return { state: { ...withNotice, phase: "observing", reobserved: true }, effects: [{ type: "observe" }] };
  }
  const words = spoken(s.language);
  const clarify = s.pack?.surface === "phone" ? words.clarifyPhone : words.clarify;
  const shown: TeachingAction = band === "uncertain" ? { ...action, kind: "clarify", speech: clarify, target: undefined } : action;
  return showGuidance(withNotice, shown);
}

/** The action's overlay, with the text around its target so the label can keep clear of it. */
export function overlayOf(s: HodeState, action: TeachingAction) {
  const nearby = action.target && s.observation ? neighboursOf(action.target.bounds, s.observation.elements) : [];
  return overlayFor(action, pinFor(s), nearby);
}

/**
 * Teach mode teaches the why: a full demonstration or a correction ends with the step's explanation
 * (unless it already includes it). Help and Agent keep corrections and demonstrations short.
 */
export function withWhy(s: HodeState, action: TeachingAction): TeachingAction {
  const why = currentStep(s)?.explain;
  const teaches = action.kind === "correct" || (action.kind === "guide" && action.assistanceLevel === "demonstrate");
  if (s.mode !== "teach" || !why || !teaches || action.speech === "" || action.speech.includes(why)) return action;
  return { ...action, speech: `${action.speech} ${why}` };
}

/**
 * What to say for this guidance: the previous step's acknowledgement first, then the instruction. A
 * re-check after the learner's action, or a highlight following a scroll, only moves the highlight:
 * saying an instruction they already heard again would nag. Asked for, it's said again.
 */
function lineFor(s: HodeState, action: TeachingAction): { line: string; instruction: string } {
  const heard = s.prompted !== true && action.speech === s.instructionSaid;
  const instruction = heard ? "" : action.speech;
  return { line: [s.pendingAck ?? "", instruction].filter((part) => part !== "").join(" "), instruction };
}

export function showGuidance(s: HodeState, shown: TeachingAction): Transition {
  const action = withWhy(s, shown);
  const primitives = overlayOf(s, action);
  const effects: HodeEffect[] = [primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" }];
  const { line, instruction } = lineFor(s, action);
  if (line !== "") effects.push({ type: "say", text: line });
  effects.push({ type: "startStuckTimer", ms: STUCK_MS });
  const ack = s.pendingAck ?? s.ack;
  const instructionSaid = instruction === "" ? s.instructionSaid : instruction;
  return { state: { ...s, phase: "guiding", action, correction: undefined, reobserved: false, pendingAck: undefined, ack, instructionSaid, prompted: false }, effects };
}

function finishOpenHode(s: HodeState, action: TeachingAction): Transition {
  return {
    state: { ...s, phase: "success", action: undefined },
    effects: [{ type: "cancelStuckTimer" }, { type: "clearOverlay" }, { type: "say", text: action.speech || spoken(s.language).hodeCompleteSpeech }],
  };
}

/** Bigger than this many times the (padded) mark, an answer's target is the page or window around it, not what was asked about. */
const MAX_ANSWER_TARGET_GROWTH = 4;
const MARKED_AREA_ID = "marked-area";

/** A Point & Ask answer points within what the learner marked; one aimed at the whole page rings the mark itself. */
function fitToMark(action: TeachingAction, mark: LearnerAnnotation | undefined): TeachingAction {
  const target = action.target;
  if (!mark || !target) return action;
  const allowed = area(padRect(mark.shape.bounds, QUESTION_PADDING_PX)) * MAX_ANSWER_TARGET_GROWTH;
  if (area(target.bounds) <= allowed) return action;
  return { ...action, target: { elementId: MARKED_AREA_ID, bounds: mark.shape.bounds, confidence: 1, label: "" } };
}

function showAnswer(s: HodeState, reply: TeachingAction): Transition {
  const action = fitToMark(reply, s.question);
  // Ringing the mark itself, the beam replaces the mark's dashed outline.
  const primitives = action.target?.elementId === MARKED_AREA_ID ? overlayOf({ ...s, question: undefined, focusRegion: undefined }, action) : overlayOf(s, action);
  return {
    state: { ...s, phase: "answering", action, answerSaid: false },
    effects: [primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" }, { type: "say", text: action.speech }],
  };
}
