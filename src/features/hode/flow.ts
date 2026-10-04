import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import { localizePack } from "../../task-packs/localize";
import { area, padRect } from "../../lib/coords";
import type { AssistanceLevel, HodeMode, LearnerAnnotation, Rect, ScreenObservation, TeachingAction, TeachingContext, UiElement } from "../../lib/types";
import {
  QUESTION_PADDING_PX,
  STUCK_MS,
  currentStep,
  standingBy,
  withTurn,
  initialState,
  noop,
  pinFor,
  type EventOf,
  type HodeEffect,
  type HodeState,
  type Transition,
} from "./model";
import { diffScreens, isUnchanged, summarizeActions } from "./change";
import { neighboursOf } from "./neighbours";
import { confidenceBand, nudgeStartLevel, overlayFor, quieterOf } from "./policy";
import { regionAround } from "./region";
import { acknowledgement } from "./ack";

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
  // Teach opens with the idea: what the learner is about to make, and that they do the clicking.
  const pendingIntro = mode === "teach" && pack.concept ? `${pack.concept} ${spoken(s.language).youDoTheClicking}` : undefined;
  const begun = beginStep({ ...s, goal, mode, agentStyle, pack, app: pack.app, notice: undefined, pendingIntro }, 0);
  // The pack's practice file opens with the lesson in every mode: it's setup, not the skill, and the steps need its data.
  const launch = e.pack.launch ? { launch: e.pack.launch } : {};
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
  // Teach's opening fills the time the learner spends opening the app.
  const line = [s.pendingIntro ?? "", speech].filter((part) => part !== "").join(" ");
  const effects: HodeEffect[] = [{ type: "clearOverlay" }, { type: "cancelStuckTimer" }, { type: "say", text: line }];
  return { state: { ...s, phase: "guiding", observation, action, waitingForApp: app, pendingIntro: undefined }, effects };
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
      whySaid: false,
      claimedDone: false,
      offerSkip: false,
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
  // A practice round starts every step with Hodey only watching, however much help the skill last needed.
  const nudged = nudgeStartLevel(s.mode, e.record, remembered);
  const level = s.practice === true ? quieterOf(nudged, "observe") : nudged;
  // A learner who already does this with Hodey only watching doesn't need the idea explained again.
  const pendingIntro = (level === "observe" || level === "independent") && s.practice !== true ? undefined : s.pendingIntro;
  return { state: { ...s, level, pendingIntro, freshRead: false }, effects: [{ type: "observe" }] };
}

export function onObserved(s: HodeState, e: EventOf<"OBSERVED">): Transition {
  if (s.phase !== "observing") return noop(s);
  // A question is answered wherever the learner is looking; only guidance waits for the right app.
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (!asking && inWrongApp(s, e.observation)) return waitForApp(s, e.observation);
  // Help with an open goal watches until the learner asks or gets stuck: no model call yet.
  if (!asking && standingBy(s) && s.action === undefined) return { state: { ...s, phase: "guiding", observation: e.observation }, effects: [{ type: "startStuckTimer", ms: STUCK_MS }] };
  // A second look at a screen that hasn't changed would only get the same unsure answer: ask the learner instead.
  const sameScreen = s.reobserved && !asking && s.observation !== undefined && isUnchanged(diffScreens(s.observation, e.observation));
  if (sameScreen) return showGuidance({ ...s, observation: e.observation }, clarifyFor(s));
  return requestReason({ ...s, observation: e.observation, waitingForApp: asking ? s.waitingForApp : undefined });
}

/** "I'm not sure which control you need": said instead of pointing when Hodey can't tell where. */
function clarifyFor(s: HodeState): TeachingAction {
  const words = spoken(s.language);
  const speech = s.pack?.surface === "phone" ? words.clarifyPhone : words.clarify;
  return { kind: "clarify", speech, skill: currentStep(s)?.skill ?? "", assistanceLevel: s.level };
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
    lastInstruction: s.open ? (s.instructionSaid ?? s.action?.speech) : undefined,
    doneSteps: s.open ? s.openDone : undefined,
    history: s.dialogue,
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
  // Whatever form a reply to a question takes (even "complete"), it's shown as the answer, so the question never lingers.
  const asking = s.spokenQuestion !== undefined || s.question !== undefined;
  if (asking) return showAnswer(withNotice, { ...e.action, kind: "answer" });
  // An answer nobody asked for is guidance: shown as an answer, it would fold away and end the Hode.
  const action: TeachingAction = e.action.kind === "answer" ? { ...e.action, kind: "guide" } : e.action;
  if (action.kind === "complete" && s.open) return finishOpenHode(openProgress(withNotice, action), action);
  if (s.open) return showOpenAction(openProgress(withNotice, action), action);
  const band = action.target ? confidenceBand(action.target.confidence) : "uncertain";
  // A correction is worth saying even when its target isn't on screen (the learner left the page).
  if (band === "uncertain" && action.kind === "correct") return showGuidance(withNotice, { ...action, target: undefined });
  if (band === "uncertain" && !s.reobserved) {
    return { state: { ...withNotice, phase: "observing", reobserved: true }, effects: [{ type: "observe" }] };
  }
  return showGuidance(withNotice, band === "uncertain" ? clarifyFor(s) : action);
}

/** Two instructions that share at least this share of their words are one step said two ways. */
const SAME_STEP_OVERLAP = 0.6;
/** Words this short ("ok", "to") don't tell instructions apart. */
const MIN_INSTRUCTION_WORD = 3;

const instructionWords = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= MIN_INSTRUCTION_WORD),
  );

/** The model gave a new instruction, not the last one reworded. */
function movedOn(previous: string, next: string): boolean {
  const a = instructionWords(previous);
  const b = instructionWords(next);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / Math.max(1, Math.min(a.size, b.size)) < SAME_STEP_OVERLAP;
}

/**
 * An open-ended Hode has no success signal: when the learner acted and the model moved on to a new
 * instruction, the last one was done. It's acknowledged, and the next step starts at the mode's level.
 */
function openProgress(s: HodeState, action: TeachingAction): HodeState {
  const previous = s.action;
  const actionable = (kind: TeachingAction["kind"]) => kind === "guide" || kind === "correct";
  const done = s.actedSinceInstruction === true && previous !== undefined && actionable(previous.kind) && action.kind !== "clarify" && movedOn(previous.speech, action.speech);
  if (!done) return s;
  const openDone = [...(s.openDone ?? []), previous.speech];
  if (action.kind === "complete") return { ...s, openDone };
  const ack = acknowledgement(s);
  const acknowledged: HodeState = ack ? { ...s, pendingAck: ack, lastAck: ack } : s;
  const fresh = { level: OPEN_START[s.mode], escalated: false, toppedOut: false, mistakes: 0, wrongActions: 0, stepActions: [], instructionSaid: undefined };
  return { ...acknowledged, ...fresh, openDone, actedSinceInstruction: false };
}

/** An open-ended Hode's next instruction, after any step it closes. It has only the model's words: an unsure target isn't drawn, but the line is still said. */
function showOpenAction(s: HodeState, action: TeachingAction): Transition {
  const band = action.target ? confidenceBand(action.target.confidence) : "uncertain";
  if (band !== "uncertain") return showGuidance(s, action);
  if (action.speech !== "") return showGuidance(s, { ...action, target: undefined });
  if (!s.reobserved) return { state: { ...s, phase: "observing", reobserved: true }, effects: [{ type: "observe" }] };
  return showGuidance(s, clarifyFor(s));
}

/** The action's overlay, with the text around its target so the label can keep clear of it, and a hint's area. */
export function overlayOf(s: HodeState, action: TeachingAction) {
  const elements = s.observation?.elements ?? [];
  const nearby = action.target ? neighboursOf(action.target.bounds, elements) : [];
  return overlayFor(action, pinFor(s), nearby, hintArea(action, elements, s.observation?.window?.bounds));
}

/** Where a hint says to look: the run of controls its target sits among, from the same screen read. */
function hintArea(action: TeachingAction, elements: UiElement[], frame?: Rect): Rect | undefined {
  const target = action.target;
  if (action.assistanceLevel !== "hint" || !target) return undefined;
  const element = elements.find((e) => e.id === target.elementId);
  return element ? regionAround(element, elements, frame) : undefined;
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
  const parts = [s.pendingIntro, s.pendingAck, s.pendingReason, s.pendingNote, instruction];
  return { line: parts.filter((part): part is string => part !== undefined && part !== "").join(" "), instruction };
}

export function showGuidance(s: HodeState, shown: TeachingAction): Transition {
  const action = withWhy(s, shown);
  const primitives = overlayOf(s, action);
  const effects: HodeEffect[] = [primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" }];
  const { line, instruction } = lineFor(s, action);
  if (line !== "") effects.push({ type: "say", text: line });
  effects.push({ type: "startStuckTimer", ms: STUCK_MS });
  const why = currentStep(s)?.explain;
  const state: HodeState = {
    ...s,
    phase: "guiding",
    action,
    correction: undefined,
    reobserved: false,
    pendingIntro: undefined,
    pendingAck: undefined,
    pendingReason: undefined,
    pendingNote: undefined,
    ack: s.pendingAck ?? s.ack,
    reason: s.pendingReason ?? s.reason,
    instructionSaid: instruction === "" ? s.instructionSaid : instruction,
    dialogue: instruction === "" ? s.dialogue : withTurn(s.dialogue, { who: "hodey", text: instruction }),
    whySaid: s.whySaid === true || (why !== undefined && instruction.includes(why)),
    actedSinceInstruction: instruction === "" ? s.actedSinceInstruction : false,
    prompted: false,
  };
  return { state, effects };
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
    state: { ...s, phase: "answering", action, answerSaid: false, dialogue: withTurn(s.dialogue, { who: "hodey", text: action.speech }) },
    effects: [primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" }, { type: "say", text: action.speech }],
  };
}
