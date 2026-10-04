import { padRect } from "../../lib/coords";
import { overlayOf, requestReason } from "./flow";
import { continueAfterCheckpoint, takeOver } from "./execute";
import { clampToMode } from "./policy";
import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import {
  QUESTION_PADDING_PX,
  initialState,
  nextHode,
  noop,
  pinOverlay,
  type EventOf,
  type HodeEffect,
  type HodePhase,
  type HodeState,
  type Transition,
  STUCK_MS,
  withTurn,
} from "./model";

const IN_HODE: HodePhase[] = ["observing", "reasoning", "guiding", "answering", "recovering", "acting"];
/** A checkpoint is already Hodey waiting on the learner, so it isn't paused. */
const PAUSABLE: HodePhase[] = IN_HODE;
const STOP_EVERYTHING: HodeEffect[] = [{ type: "clearOverlay" }, { type: "cancelStuckTimer" }, { type: "stopSpeech" }];

function resumeTarget(s: HodeState): HodePhase {
  if (s.phase === "checkpoint" || s.phase === "paused") return s.phase;
  // Guidance already given comes back as it was; only a step still being worked out is looked at again.
  if (s.phase === "guiding" && s.action) return "guiding";
  if ((s.pack || s.open) && IN_HODE.includes(s.phase)) return "observing";
  return s.phase === "goal_entry" ? "goal_entry" : "idle";
}

/** Where a question or a pause leaves from: the phase to return to, and the guidance to bring back with it. */
function leaving(s: HodeState): Pick<HodeState, "resumePhase" | "resumeAction" | "resumeObservation" | "pausedResume"> {
  const resumePhase = resumeTarget(s);
  // Paused: the question returns to the pause, which keeps its own way back.
  const pausedResume = s.phase === "paused" ? { resumePhase: s.resumePhase, resumeAction: s.resumeAction, resumeObservation: s.resumeObservation } : s.pausedResume;
  const guidance = resumePhase === "guiding" ? { resumeAction: s.action, resumeObservation: s.observation } : { resumeAction: undefined, resumeObservation: undefined };
  return { resumePhase, ...guidance, pausedResume };
}

/** The interrupted step, exactly as it was: its card and highlight, with nothing said again. */
function restoreGuidance(state: HodeState, s: HodeState): Transition {
  const restored: HodeState = { ...state, action: s.resumeAction, observation: s.resumeObservation ?? s.observation };
  const primitives = s.resumeAction ? overlayOf(restored, s.resumeAction) : [];
  const overlay: HodeEffect = primitives.length > 0 ? { type: "renderOverlay", primitives } : { type: "clearOverlay" };
  // Waiting for the learner's app is not being stuck.
  return { state: restored, effects: restored.waitingForApp ? [overlay] : [overlay, { type: "startStuckTimer", ms: STUCK_MS }] };
}

/** Return to where the learner was; a step still being prepared is looked at again. */
function resume(s: HodeState): Transition {
  const phase = s.resumePhase ?? "idle";
  const state: HodeState = {
    ...s,
    phase,
    resumePhase: undefined,
    resumeAction: undefined,
    resumeObservation: undefined,
    question: undefined,
    spokenQuestion: undefined,
    lookUp: undefined,
    answerSaid: undefined,
  };
  if (phase === "guiding") return restoreGuidance(state, s);
  if (phase === "observing") return { state, effects: [{ type: "observe" }] };
  // Back to a pause after a question: the pause gets its own way back again.
  if (phase === "paused") return { state: { ...state, ...s.pausedResume, pausedResume: undefined }, effects: [{ type: "clearOverlay" }] };
  // A mark just set is shown; after an answer, nothing lingers on screen.
  return { state, effects: [s.phase === "annotating" ? pinOverlay(state.focusRegion) : { type: "clearOverlay" }] };
}

/**
 * A new mode applies at once: the current step's help level moves into the mode's range and, if Hodey
 * is guiding, it re-reasons so the instruction and highlight match (e.g. agent → teach hides the answer).
 */
function withStuckReset(t: Transition): Transition {
  return { ...t, effects: [{ type: "cancelStuckTimer" }, ...t.effects] };
}

export function onSetMode(s: HodeState, e: EventOf<"SET_MODE">): Transition {
  if (s.mode === e.mode) return noop(s);
  const changed: HodeState = { ...s, mode: e.mode, level: clampToMode(e.mode, s.level), showAllSteps: false };
  return replan(s, changed);
}

/** Guiding or about to press: plan the step again under the new mode (a pending press is dropped). */
function replan(s: HodeState, changed: HodeState): Transition {
  if ((s.phase !== "guiding" && s.phase !== "acting") || !s.observation) return { state: changed, effects: [] };
  return withStuckReset(requestReason({ ...changed, prompted: true }));
}

/** "Do it for me" or "guide me": agent mode in that style. Asking Hodey to do it again clears a handed-back step. */
export function onSetAgentStyle(s: HodeState, e: EventOf<"SET_AGENT_STYLE">): Transition {
  if (s.mode === "agent" && s.agentStyle === e.style) return noop(s);
  const changed: HodeState = { ...s, mode: "agent", agentStyle: e.style, level: clampToMode("agent", s.level), showAllSteps: false, handedBack: false, hodeyTries: 0 };
  if (s.phase === "acting" && e.style === "guide") return takeOver(changed);
  return replan(s, changed);
}

export function onShowAllSteps(s: HodeState): Transition {
  return s.pack ? { state: { ...s, showAllSteps: !s.showAllSteps }, effects: [] } : noop(s);
}

/** Phases a spoken question can't interrupt: the learner is typing a goal or marking the screen. */
const NOT_LISTENING: HodePhase[] = ["goal_entry", "annotating"];

/**
 * A spoken question wins over whatever Hodey was doing: speech stops, in-flight reasoning is dropped
 * (requestId moves on), and Hodey looks at the whole screen before answering.
 */
export function onVoiceQuestion(s: HodeState, e: EventOf<"VOICE_QUESTION">): Transition {
  const question = e.question.trim();
  if (question === "" || NOT_LISTENING.includes(s.phase)) return noop(s);
  const answeringAlready = (s.phase === "observing" && s.spokenQuestion !== undefined) || s.phase === "answering";
  const from = answeringAlready && s.resumePhase ? { resumePhase: s.resumePhase, resumeAction: s.resumeAction, resumeObservation: s.resumeObservation } : leaving(s);
  const requestId = s.requestId + 1;
  // A quick acknowledgement while Hodey looks, varied so it doesn't sound canned.
  const { acks } = spoken(s.language);
  const ack = acks[requestId % acks.length];
  return {
    state: { ...s, ...from, phase: "observing", spokenQuestion: question, lookUp: e.lookUp === true, question: undefined, requestId, dialogue: withTurn(s.dialogue, { who: "learner", text: question }) },
    effects: [{ type: "stopSpeech" }, { type: "cancelStuckTimer" }, { type: "say", text: ack }, { type: "observe" }],
  };
}

export function onAnnotateStart(s: HodeState): Transition {
  if (s.phase === "annotating" || s.phase === "paused") return noop(s);
  return {
    state: { ...s, ...leaving(s), phase: "annotating" },
    effects: [{ type: "cancelStuckTimer" }, { type: "stopSpeech" }],
  };
}

export function onAnnotateCancel(s: HodeState): Transition {
  return s.phase === "annotating" ? resume(s) : noop(s);
}

export function onAnnotationSubmitted(s: HodeState, e: EventOf<"ANNOTATION_SUBMITTED">): Transition {
  if (s.phase !== "annotating") return noop(s);
  const { annotation } = e;
  if (annotation.intent === "focus") {
    return resume({ ...s, focusRegion: annotation, notice: s.pack ? s.notice : COPY.focusSet });
  }
  const dialogue = annotation.question ? withTurn(s.dialogue, { who: "learner", text: annotation.question }) : s.dialogue;
  return {
    state: { ...s, phase: "observing", question: annotation, dialogue },
    effects: [{ type: "observe", region: padRect(annotation.shape.bounds, QUESTION_PADDING_PX) }],
  };
}

export function onDismiss(s: HodeState): Transition {
  switch (s.phase) {
    case "answering":
      return resume(s);
    case "success":
      return { state: nextHode(s), effects: [{ type: "clearOverlay" }] };
    case "goal_entry":
      return { state: { ...nextHode(s), focusRegion: s.focusRegion }, effects: [] };
    default:
      return noop(s);
  }
}

/** An answer's marks have done their job once it's been said; the answer itself stays on the notch. */
export function onSpeechFinished(s: HodeState): Transition {
  return s.phase === "answering" ? { state: { ...s, answerSaid: true }, effects: [{ type: "clearOverlay" }] } : noop(s);
}

export function onPause(s: HodeState): Transition {
  if (!PAUSABLE.includes(s.phase)) return noop(s);
  // Bumping requestId drops any reasoning still in flight; guidance on show comes back as it was.
  return { state: { ...s, ...leaving(s), phase: "paused", requestId: s.requestId + 1 }, effects: STOP_EVERYTHING };
}

/** "Continue": out of a pause, or past a checkpoint once the learner has checked Hodey's work. */
export function onResume(s: HodeState): Transition {
  if (s.phase === "checkpoint") return continueAfterCheckpoint(s);
  return s.phase === "paused" ? resume(s) : noop(s);
}

export function onEndHode(s: HodeState): Transition {
  if (s.phase === "idle") return noop(s);
  return { state: nextHode(s), effects: STOP_EVERYTHING };
}

export function onSetLanguage(s: HodeState, e: EventOf<"SET_LANGUAGE">): Transition {
  return { state: { ...s, language: e.language }, effects: [] };
}

export function onProviderFailed(s: HodeState, e: EventOf<"PROVIDER_FAILED">): Transition {
  const stale = e.requestId !== undefined && e.requestId !== s.requestId;
  if (stale || (s.phase !== "observing" && s.phase !== "reasoning")) return noop(s);
  return { state: { ...s, phase: "recovering", notice: e.message }, effects: [{ type: "cancelStuckTimer" }] };
}

export function onRetry(s: HodeState): Transition {
  if (s.phase !== "recovering") return noop(s);
  return { state: { ...s, phase: "observing", notice: undefined }, effects: [{ type: "observe" }] };
}
