import { area, center, containsPoint, intersects } from "../lib/coords";
import { COPY } from "../lib/copy";
import type { ActionTarget, LearnerAnnotation, Rect, TaskStep, TeachingAction, TeachingContext, UiElement } from "../lib/types";
import { findByNames, nameMatches } from "../features/hode/signals";
import type { ReasoningProvider } from "./interfaces";

const ROLE_MISMATCH_PENALTY = 0.8;
const GENERAL_SKILL = "general.point_and_ask";

/** Deterministic local planner: grounds task-pack steps against the observed UI. Always available offline. */
export class TaskPackReasoningProvider implements ReasoningProvider {
  readonly id = "local-task-pack";

  async reason(context: TeachingContext): Promise<TeachingAction> {
    if (context.focusRegion?.intent === "ask") return answerAbout(context, context.focusRegion);
    if (context.utterance) return answerSpoken(context, context.utterance);
    if (!context.step) throw new Error("No task step to teach — start a Hode with a known goal first.");
    return guideStep(context, context.step);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

function roleMatches(element: UiElement, role?: string): boolean {
  return role === undefined || element.role.toLowerCase() === role.toLowerCase();
}

function locateTarget(step: TaskStep, elements: UiElement[], focus?: Rect): ActionTarget | undefined {
  const candidates = findByNames(elements, step.target.names);
  if (candidates.length === 0) return undefined;
  const score = (e: UiElement) => (roleMatches(e, step.target.role) ? 2 : 0) + (focus && intersects(e.bounds, focus) ? 1 : 0);
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const confidence = roleMatches(best, step.target.role) ? best.confidence : best.confidence * ROLE_MISMATCH_PENALTY;
  return { elementId: best.id, bounds: best.bounds, confidence, label: step.target.label ?? best.name };
}

function guideStep(context: TeachingContext, step: TaskStep): TeachingAction {
  const level = context.assistanceLevel;
  const target = locateTarget(step, context.observation.elements, context.focusRegion?.shape.bounds);
  if (!target) {
    const phone = context.pack?.surface === "phone";
    // On the phone the learner has usually left the page the target is on: the correction still helps.
    // On Windows, clarify lets the vision model try to locate the target before Hodey gives up on it.
    if (phone && context.correction) return { kind: "correct", speech: context.correction, skill: step.skill, assistanceLevel: level };
    const speech = phone ? COPY.clarifyPhone : COPY.clarify;
    return { kind: "clarify", speech, skill: step.skill, assistanceLevel: level };
  }
  return {
    kind: context.correction ? "correct" : "guide",
    speech: context.correction ?? step.speech[level],
    target,
    skill: step.skill,
    assistanceLevel: level,
  };
}

/** Names shorter than this are too generic to match against speech ("OK", "A1"). */
const MIN_SPOKEN_NAME = 4;

/**
 * Offline answer to a spoken question: point at a control the learner named ("where is Insert?").
 * Anything else needs the vision model; the fallback says so honestly.
 */
function answerSpoken(context: TeachingContext, utterance: string): TeachingAction {
  const said = utterance.toLowerCase();
  const named = context.observation.elements
    .filter((e) => e.name.length >= MIN_SPOKEN_NAME && said.includes(e.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const skill = context.step?.skill ?? GENERAL_SKILL;
  const level = context.assistanceLevel;
  if (!named) return { kind: "answer", speech: COPY.needVisionToAnswer, skill, assistanceLevel: level };
  const target = { elementId: named.id, bounds: named.bounds, confidence: named.confidence, label: named.name };
  return { kind: "answer", speech: COPY.itsHere(named.name), target, skill, assistanceLevel: level };
}

/** Prefer the smallest element whose centre is inside the mark — a button over the pane that contains it. */
function pickMarkedElement(elements: UiElement[], region: Rect): UiElement | undefined {
  const inside = elements.filter((e) => containsPoint(region, center(e.bounds)));
  const pool = inside.length > 0 ? inside : elements.filter((e) => intersects(e.bounds, region));
  return [...pool].sort((a, b) => area(a.bounds) - area(b.bounds))[0];
}

function describe(element: UiElement, context: TeachingContext): string {
  const matches = (step: TaskStep) => step.target.names.some((n) => nameMatches(n, element.name));
  const packStep = context.pack?.steps.find(matches);
  const base = packStep ? `That's ${element.name}. ${packStep.explain}` : `That's the "${element.name}" ${element.role}.`;
  const isCurrentTarget = context.step !== undefined && matches(context.step);
  return isCurrentTarget ? `${base} It's the one you need for this step.` : base;
}

function answerAbout(context: TeachingContext, annotation: LearnerAnnotation): TeachingAction {
  const element = pickMarkedElement(context.observation.elements, annotation.shape.bounds);
  const skill = context.step?.skill ?? GENERAL_SKILL;
  const level = context.assistanceLevel;
  if (!element) return { kind: "answer", speech: COPY.nothingMarked, skill, assistanceLevel: level };
  return {
    kind: "answer",
    speech: describe(element, context),
    target: { elementId: element.id, bounds: element.bounds, confidence: element.confidence, label: element.name },
    skill,
    assistanceLevel: level,
  };
}
