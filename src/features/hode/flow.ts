import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import { localizePack } from "../../task-packs/localize";
import { appFromGoal } from "../../task-packs/match";
import { area, padRect } from "../../lib/coords";
import type { AssistanceLevel, HodeMode, LearnerAnnotation, OverlayPrimitive, Rect, ScreenObservation, TeachingAction, TeachingContext, UiElement } from "../../lib/types";
import {
  QUESTION_PADDING_PX,
  STUCK_MS,
  currentStep,
  nextHode,
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
import { areaAround, regionAround } from "./region";
import { acknowledgement } from "./ack";
import { withPlanRequest } from "./planning";

/** Verbs that open an app, in English, Hindi and Roman Hinglish. */
const OPEN_VERB = /^(?:open|opening|launch|start|run|खोल\S*|khol\S*)$/u;
/** Words a how-to-open goal carries besides the verb and the app ("how do I…", "कैसे", "kaise…hain"). */
const OPEN_FILLER = new Set("how to do i can you me the my a an please teach show up on this pc computer microsoft ms app kaise karte hain hai karo mujhe कैसे करते हैं है करें मुझे".split(" "));

/**
 * The goal is opening its app and nothing else: once the app's own words and filler are set aside, only
 * an opening verb is left. "How do I start a new workbook in Excel" leaves "new workbook", so it isn't.
 */
function opensApp(goal: string, app: string): boolean {
  const appWords = new Set(app.toLowerCase().split(/\s+/));
  const rest = goal
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !appWords.has(word) && appFromGoal(word) !== app && !OPEN_FILLER.has(word));
  return rest.length > 0 && rest.every((word) => OPEN_VERB.test(word));
}

/** Opening an app from the taskbar, a skill every open-ended Hode can need. */
const GENERAL_OPEN_SKILL = "windows.start.open_app";

/** Open-ended Hodes have no saved skill: the vision model phrases each step at the mode's level. */
const OPEN_START: Record<HodeMode, AssistanceLevel> = { teach: "hint", help: "observe", agent: "guide" };

export function onStartHode(s: HodeState): Transition {
  if (s.phase !== "idle") return noop(s);
  return { state: { ...nextHode(s), phase: "goal_entry", focusRegion: s.focusRegion }, effects: [] };
}

export function onGoalSubmitted(s: HodeState, e: EventOf<"GOAL_SUBMITTED">): Transition {
  const goal = e.goal.trim();
  if (s.phase !== "goal_entry" || goal === "") return noop(s);
  const mode = e.mode ?? s.mode;
  const agentStyle = e.agentStyle ?? s.agentStyle;
  if (!e.pack && e.openAllowed) {
    // Opening the app is the lesson itself: it isn't brought forward for the learner.
    const openingApp = e.app !== undefined && opensApp(goal, e.app);
    const focus: HodeEffect[] = e.app && !openingApp ? [{ type: "focusApp", app: e.app }] : [];
    const level = OPEN_START[mode];
    return { state: { ...s, goal, app: e.app, openingApp, mode, agentStyle, open: true, level, notice: undefined, phase: "observing" }, effects: [...focus, { type: "observe" }] };
  }
  const words = spoken(s.language);
  // Nothing to plan it with yet: say the vision model is loading, rather than that there's no lesson for it.
  const nothing = e.visionStarting ? words.visionLoading : words.noPack;
  if (!e.pack) return { state: { ...s, goal, notice: nothing }, effects: [{ type: "say", text: nothing }] };
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
  // An open-ended Hode says how to open its app (a lesson's practice file opens by itself): not just "open it".
  const speech = s.pack?.surface === "phone" ? words.connectPhone : s.open ? words.howToOpen(app) : words.switchToApp(app);
  const action: TeachingAction = { kind: "clarify", speech, skill: currentStep(s)?.skill ?? "", assistanceLevel: s.level };
  // Already said: a fresh look that still finds another app keeps the waiting card, quietly.
  if (s.waitingForApp === app) return { state: { ...s, phase: "guiding", observation }, effects: [] };
  const waiting: HodeState = { ...s, phase: "guiding", observation, action, waitingForApp: app };
  // An open-ended Hode first reads the taskbar, to point at its search box; the card shows the way meanwhile.
  if (s.open && s.pack?.surface !== "phone") return { state: { ...waiting, shellPending: true }, effects: [{ type: "clearOverlay" }, { type: "cancelStuckTimer" }, { type: "observeShell" }] };
  // Teach's opening fills the time the learner spends opening the app.
  const line = [s.pendingIntro ?? "", speech].filter((part) => part !== "").join(" ");
  const effects: HodeEffect[] = [{ type: "clearOverlay" }, { type: "cancelStuckTimer" }, { type: "say", text: line }];
  return { state: { ...waiting, pendingIntro: undefined }, effects };
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
      pendingNote: undefined,
      whySaid: false,
      areaShown: false,
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
  if (!asking && s.openingApp) return openedApp({ ...s, observation: e.observation });
  // Help with an open goal watches until the learner asks or gets stuck: no model call yet.
  if (!asking && standingBy(s) && s.action === undefined) return { state: { ...s, phase: "guiding", observation: e.observation }, effects: [{ type: "startStuckTimer", ms: STUCK_MS }] };
  // A second look at a screen that hasn't changed would only get the same unsure answer: ask the learner instead.
  const sameScreen = s.reobserved && !asking && s.observation !== undefined && isUnchanged(diffScreens(s.observation, e.observation));
  if (sameScreen) return showGuidance({ ...s, observation: e.observation }, clarifyFor(s));
  return requestReason({ ...s, observation: e.observation, waitingForApp: asking ? s.waitingForApp : undefined, shellPending: asking ? s.shellPending : false });
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
    plan: s.open ? s.plan?.steps : undefined,
    history: s.dialogue,
    lookUp: s.lookUp === true ? true : undefined,
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
  // The screen couldn't answer a how/where question: look it up once (offline help, then the web if it's on).
  if (asking && shouldLookUp(s, e.action)) return requestReason({ ...withNotice, lookUp: true });
  if (asking) return showAnswer(withNotice, { ...e.action, kind: "answer" });
  // An answer nobody asked for is guidance: shown as an answer, it would fold away and end the Hode.
  const action: TeachingAction = e.action.kind === "answer" ? { ...e.action, kind: "guide" } : e.action;
  if (action.kind === "complete" && s.open) return finishOpenHode(openProgress(withNotice, action), action);
  if (s.open) return withPlanRequest(showOpenAction(openProgress(withNotice, action), action));
  const band = action.target ? confidenceBand(action.target.confidence) : "uncertain";
  // A correction is worth saying even when its target isn't on screen (the learner left the page).
  if (band === "uncertain" && action.kind === "correct") return showGuidance(withNotice, { ...action, target: undefined });
  if (band === "uncertain" && !s.reobserved) {
    return { state: { ...withNotice, phase: "observing", reobserved: true }, effects: [{ type: "observe" }] };
  }
  return showGuidance(withNotice, band === "uncertain" ? clarifyFor(s) : action);
}

/** "How do I…", "where is…", "which…": questions reference steps can answer when the screen can't. */
const HOW_OR_WHERE = /^(?:how|where|which)\b|कैसे|कहाँ|कहां|\bkaise\b|\bkahan\b/i;

/**
 * A spoken how/where question whose screen-first answer couldn't help (the model asked back, or had
 * nothing to point at) gets one more try with reference steps. Anything else never triggers a lookup.
 */
function shouldLookUp(s: HodeState, action: TeachingAction): boolean {
  const question = s.spokenQuestion;
  if (question === undefined || s.lookUp === true || !HOW_OR_WHERE.test(question.trim())) return false;
  return action.kind === "clarify" || action.target === undefined;
}

/** Two instructions that share at least this share of their words are one step said two ways. */
const SAME_STEP_OVERLAP = 0.6;
/** Words this short don't tell instructions apart; two letters still do ("OK" vs "Save"). */
const MIN_INSTRUCTION_WORD = 2;
/** Words every instruction shares, which say nothing about which step it is. */
const INSTRUCTION_FILLER = new Set(["the", "a", "an", "to", "at", "on", "in", "of", "and", "then", "now", "your", "you", "it", "this", "that", "please"]);
/** Devanagari's nukta (ज़ vs ज): written inconsistently, so it's ignored. */
const NUKTA = /\u093C/g;

const normalizeInstruction = (text: string): string =>
  text
    .normalize("NFC")
    .toLowerCase()
    .replace(NUKTA, "")
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const instructionWords = (text: string): Set<string> =>
  new Set(
    normalizeInstruction(text)
      .split(" ")
      .filter((word) => word.length >= MIN_INSTRUCTION_WORD && !INSTRUCTION_FILLER.has(word)),
  );

/** The model gave a new instruction, not the last one reworded. */
function movedOn(previous: string, next: string): boolean {
  if (normalizeInstruction(previous) === normalizeInstruction(next)) return false;
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
  const fresh = { level: OPEN_START[s.mode], escalated: false, toppedOut: false, mistakes: 0, wrongActions: 0, stepActions: [], instructionSaid: undefined, areaShown: false };
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
  // Teach lets the learner try a question on their own first: the area lights up once they're stuck.
  const area = s.mode !== "teach" || s.areaShown === true ? hintArea(action, elements, s.observation?.window?.bounds) : undefined;
  return overlayFor(action, pinFor(s), nearby, area);
}

/**
 * Where a hint says to look: the run of look-alike controls its target sits among, or, for a control
 * that stands alone, a generous area around it (a hint still points the way; it just doesn't pinpoint).
 */
function hintArea(action: TeachingAction, elements: UiElement[], frame?: Rect): Rect | undefined {
  const target = action.target;
  if (action.assistanceLevel !== "hint" || !target) return undefined;
  const element = elements.find((e) => e.id === target.elementId);
  return (element && regionAround(element, elements, frame)) ?? areaAround(target.bounds, frame);
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

/** Taskbar controls that find an app, best first: its search box, then Start. */
const SHELL_WAYS: [RegExp, string][] = [
  [/search/i, "Search"],
  [/^start$/i, "Start"],
];

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const distance = (a: Rect, b: Rect) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);

/**
 * The best taskbar control to point at: a search box before Start; with a taskbar on each monitor, the
 * one nearest the learner's window (the overlay covers that monitor); the primary, listed first, otherwise.
 */
function shellWay(elements: UiElement[], window: Rect | undefined): { element: UiElement; label: string } | undefined {
  for (const [pattern, label] of SHELL_WAYS) {
    const found = elements.filter((element) => pattern.test(element.name));
    if (found.length === 0) continue;
    const nearest = window ? [...found].sort((a, b) => distance(a.bounds, window) - distance(b.bounds, window))[0] : found[0];
    return { element: nearest, label };
  }
  return undefined;
}

/** The taskbar read for an app Hodey is waiting for: point at where to search for it, or say the Windows-key way. */
export function onShellObserved(s: HodeState, e: EventOf<"SHELL_OBSERVED">): Transition {
  const app = s.waitingForApp;
  if (s.phase !== "guiding" || !app || s.shellPending !== true) return noop(s);
  const words = spoken(s.language);
  const way = shellWay(e.elements, s.observation?.window?.bounds);
  const intro = s.pendingIntro ? [s.pendingIntro] : [];
  const settled: HodeState = { ...s, shellPending: false, pendingIntro: undefined };
  if (!way) return { state: settled, effects: [{ type: "say", text: [...intro, words.howToOpen(app)].join(" ") }] };
  const speech = words.searchToOpen(way.label, app);
  const target = { elementId: way.element.id, bounds: way.element.bounds, confidence: way.element.confidence, label: way.label };
  const action: TeachingAction = { kind: "guide", speech, target, skill: GENERAL_OPEN_SKILL, assistanceLevel: "guide" };
  const ring: OverlayPrimitive = { kind: "highlight", bounds: way.element.bounds, label: way.label, emphasis: "precise" };
  return { state: { ...settled, action }, effects: [{ type: "renderOverlay", primitives: [ring], screen: true }, { type: "say", text: [...intro, speech].join(" ") }] };
}

/** The app the learner was learning to open is open: that was the whole goal. */
export function openedApp(s: HodeState): Transition {
  const words = spoken(s.language);
  const taught = s.waitingForApp ? [words.howToOpen(s.app ?? "")] : [];
  const state: HodeState = { ...s, phase: "success", action: undefined, waitingForApp: undefined, openDone: [...(s.openDone ?? []), ...taught] };
  return { state, effects: [{ type: "cancelStuckTimer" }, { type: "clearOverlay" }, { type: "say", text: words.openedIt(s.app ?? "") }] };
}

/** The goal is reached: the model's congratulation, then in Teach the plan's recap and a question to check the idea stuck. */
function finishOpenHode(s: HodeState, action: TeachingAction): Transition {
  const plan = s.mode === "teach" ? s.plan : undefined;
  const parts = [action.speech || spoken(s.language).hodeCompleteSpeech, plan?.recap, plan?.check?.question];
  const line = parts.filter((part): part is string => part !== undefined && part !== "").join(" ");
  return {
    state: { ...s, phase: "success", action: undefined, review: plan?.check ? { check: plan.check } : undefined },
    effects: [{ type: "cancelStuckTimer" }, { type: "clearOverlay" }, { type: "say", text: line }],
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
