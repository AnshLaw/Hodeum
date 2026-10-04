import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import { localizePack } from "../../task-packs/localize";
import type { AssistanceLevel, HodeMode, ScreenObservation, TeachingAction, TeachingContext } from "../../lib/types";
import {
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
  return { ...begun, effects: [{ type: "focusApp", app: e.pack.app }, ...begun.effects] };
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
  if (s.waitingForApp === app) return { state: { ...s, observation }, effects: [] };
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
      repointing: false,
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
  if (action.kind === "answer") return showAnswer(withNotice, action);
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
function overlayOf(s: HodeState, action: TeachingAction) {
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

/** What to say for this guidance: the previous step's acknowledgement first, then the instruction. */
function lineFor(s: HodeState, action: TeachingAction): string {
  // Re-pointing (a scroll, the target coming into view) moves the highlight; saying the same sentence again would nag.
  const repeat = (s.pack?.surface === "phone" || s.repointing === true) && action.speech === s.action?.speech;
  const instruction = repeat ? "" : action.speech;
  return [s.pendingAck ?? "", instruction].filter((part) => part !== "").join(" ");
}

export function showGuidance(s: HodeState, shown: TeachingAction): Transition {
  const action = withWhy(s, shown);
  const primitives = overlayOf(s, action);
  const effects: HodeEffect[] = [primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" }];
  const line = lineFor(s, action);
  if (line !== "") effects.push({ type: "say", text: line });
  effects.push({ type: "startStuckTimer", ms: STUCK_MS });
  const ack = s.pendingAck ?? s.ack;
  return { state: { ...s, phase: "guiding", action, correction: undefined, reobserved: false, pendingAck: undefined, ack, repointing: false }, effects };
}

function finishOpenHode(s: HodeState, action: TeachingAction): Transition {
  return {
    state: { ...s, phase: "success", action: undefined },
    effects: [{ type: "cancelStuckTimer" }, { type: "clearOverlay" }, { type: "say", text: action.speech || spoken(s.language).hodeCompleteSpeech }],
  };
}

function showAnswer(s: HodeState, action: TeachingAction): Transition {
  return {
    state: { ...s, phase: "answering", action },
    effects: [
      { type: "renderOverlay", primitives: overlayOf(s, action) },
      { type: "say", text: action.speech },
    ],
  };
}
