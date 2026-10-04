import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import type { ActionTarget, TaskStep, TeachingAction, UiElement } from "../../lib/types";
import { beginStep, onActionReady, requestReason, showGuidance } from "./flow";
import {
  CHECKPOINT_EVERY,
  MAX_HODEY_TRIES,
  PREVIEW_MS,
  currentStep,
  noop,
  pinFor,
  withLeadingEffects,
  type EventOf,
  type HodeEffect,
  type HodeState,
  type Transition,
} from "./model";
import { confidenceBand, overlayFor } from "./policy";
import { evaluateSignal, nameMatches, roleMatches } from "./signals";

/**
 * Agent · Do it for me: Hodey presses each step's control itself, verifies the result the same way it
 * verifies the learner's, and stops at checkpoints so the learner stays in the loop. Anything it
 * can't press with confidence goes back to the learner as ordinary guidance.
 *
 * Only task-pack steps are done this way, and only on the step's own target: an element from the
 * latest screen read whose name (and role) the pack names. Nothing a model or the screen says can
 * pick another control, so open-ended Hodes are always guided.
 */

const CANCEL_TIMER: HodeEffect = { type: "cancelStuckTimer" };
const ACTIONABLE: TeachingAction["kind"][] = ["guide", "correct"];

/** Hodey does this step itself: Agent · Do it for me, a desktop task pack, a step it hasn't handed back, no question open. */
export function executing(s: HodeState): boolean {
  const asking = s.question !== undefined || s.spokenQuestion !== undefined;
  const desktopPack = s.pack !== undefined && !s.open && s.pack.surface !== "phone";
  return s.mode === "agent" && s.agentStyle === "execute" && desktopPack && !s.handedBack && !asking;
}

/** The element the action points at, if the latest screen read has it and the step's target names it. */
function stepTarget(s: HodeState, target: ActionTarget): UiElement | undefined {
  const step = currentStep(s);
  const element = s.observation?.elements.find((e) => e.id === target.elementId);
  if (!step || !element) return undefined;
  const named = step.target.names.some((name) => nameMatches(name, element.name));
  return named && roleMatches(element.role, step.target.role) ? element : undefined;
}

/** Shows what Hodey is about to press and asks the runtime to press it, as the screen read saw it, after a short preview. */
function startActing(s: HodeState, action: TeachingAction, element: UiElement, observedAt: number): Transition {
  const target: ActionTarget = { ...action.target!, elementId: element.id, bounds: element.bounds };
  const button = currentStep(s)?.press ?? "left";
  const shown = overlayFor({ ...action, assistanceLevel: "demonstrate" }, pinFor(s));
  // A step the learner just finished (one handed back) is still acknowledged first.
  const line = [s.pendingAck ?? "", spoken(s.language).doing(target.label, button)].filter((part) => part !== "").join(" ");
  return {
    // Teach's opening and why are for a learner doing the step; Hodey doing it keeps to the acknowledgement.
    state: { ...s, phase: "acting", action, correction: undefined, reobserved: false, pendingIntro: undefined, pendingAck: undefined, pendingReason: undefined, ack: s.pendingAck ?? s.ack },
    effects: [
      CANCEL_TIMER,
      { type: "renderOverlay", primitives: shown },
      { type: "say", text: line },
      { type: "perform", requestId: s.requestId, request: { target, button, name: element.name, observedAt }, delayMs: PREVIEW_MS },
    ],
  };
}

/** The step is the learner's now: ordinary guidance, said with why. */
function handBack(s: HodeState, action: TeachingAction, notice: string): Transition {
  const overToYou = spoken(s.language).overToYou;
  return showGuidance({ ...s, handedBack: true, notice }, { ...action, speech: `${overToYou} ${action.speech}`.trim() });
}

/** ACTION_READY: in Do it for me, a confident target is pressed by Hodey; a less certain one is the learner's. */
export function onActionReadyActing(s: HodeState, e: EventOf<"ACTION_READY">): Transition {
  const fresh = s.phase === "reasoning" && e.requestId === s.requestId;
  const target = e.action.target;
  if (!fresh || !executing(s) || !ACTIONABLE.includes(e.action.kind) || !target) return onActionReady(s, e);
  const band = confidenceBand(target.confidence);
  // Too unsure to point precisely: re-look first, then ask, exactly as guidance does.
  if (band === "uncertain") return onActionReady(s, e);
  const withNotice = { ...s, notice: e.failures.length > 0 ? COPY.fallbackNotice : s.notice };
  const element = stepTarget(s, target);
  if (band === "broad" || !element || !s.observation) return showGuidance({ ...withNotice, handedBack: true, notice: spoken(s.language).overToYou }, e.action);
  return startActing(withNotice, e.action, element, s.observation.at);
}

/** Hodey did a step. It never counts as the learner's skill (and is never praised); checkpoints pause before the next one. */
function finishHodeyStep(acted: HodeState, step: TaskStep): Transition {
  const s: HodeState = { ...acted, ack: undefined, pendingAck: undefined };
  const words = spoken(s.language);
  const hodeyDid = s.hodeyDid + 1;
  const nextIndex = s.stepIndex + 1;
  const done: HodeEffect[] = [CANCEL_TIMER, { type: "clearOverlay" }];
  if (!s.pack || nextIndex >= s.pack.steps.length) {
    return { state: { ...s, hodeyDid, phase: "success", action: undefined }, effects: [...done, { type: "say", text: words.hodeyFinished }] };
  }
  const sinceCheckpoint = s.sinceCheckpoint + 1;
  if (step.checkpoint || sinceCheckpoint >= CHECKPOINT_EVERY) {
    const state: HodeState = { ...s, hodeyDid, phase: "checkpoint", stepIndex: nextIndex, sinceCheckpoint: 0, action: undefined };
    return { state, effects: [...done, { type: "say", text: words.checkpoint(step.objective) }] };
  }
  return withLeadingEffects(beginStep({ ...s, hodeyDid, sinceCheckpoint, freshRead: true }, nextIndex), done);
}

export function onHodeyActed(s: HodeState, e: EventOf<"HODEY_ACTED">): Transition {
  if (s.phase !== "acting" || e.requestId !== s.requestId) return noop(s);
  const observed: HodeState = { ...s, observation: e.observation };
  const step = currentStep(s);
  if (!step) return noop(s);
  if (evaluateSignal(step.success, e.observation)) return finishHodeyStep(observed, step);
  const hodeyTries = s.hodeyTries + 1;
  // The press didn't finish the step (a slow dialog, a missed target): look again, then let the learner do it.
  if (hodeyTries >= MAX_HODEY_TRIES) return requestReason({ ...observed, hodeyTries, handedBack: true, notice: spoken(s.language).overToYou });
  return requestReason({ ...observed, hodeyTries });
}

export function onPerformFailed(s: HodeState, e: EventOf<"PERFORM_FAILED">): Transition {
  if (s.phase !== "acting" || e.requestId !== s.requestId || !s.action) return noop(s);
  return handBack(s, s.action, e.message);
}

/** Carry on after a checkpoint with the next step. */
export function continueAfterCheckpoint(s: HodeState): Transition {
  return beginStep(s, s.stepIndex);
}

/**
 * "Let me try" while Hodey is acting or waiting at a checkpoint: the learner takes over and Hodey
 * goes back to guiding. A press still in its preview is dropped (the request id moves on).
 */
export function takeOver(s: HodeState): Transition {
  const guided: HodeState = { ...s, agentStyle: "guide", requestId: s.requestId + 1 };
  if (s.phase === "checkpoint") return continueAfterCheckpoint(guided);
  if (s.phase !== "acting" || !s.action) return noop(s);
  return withLeadingEffects(showGuidance(guided, s.action), [{ type: "stopSpeech" }]);
}
