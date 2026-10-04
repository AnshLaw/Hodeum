import { area, center, containsPoint, intersects } from "../lib/coords";
import { spoken } from "../lib/spoken";
import type { ActionTarget, LearnerAnnotation, Rect, TaskStep, TeachingAction, TeachingContext, UiElement } from "../lib/types";
import { findByNames, nameMatches, roleMatches } from "../features/hode/signals";
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

/** The first selected element (top to bottom, then left to right) inside `container`, if any. */
function firstSelectedIn(container: UiElement, elements: UiElement[]): UiElement | undefined {
  const inside = elements.filter((e) => e !== container && e.selected === true && containsPoint(container.bounds, center(e.bounds)));
  return inside.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)[0];
}

function locateTarget(step: TaskStep, elements: UiElement[], focus?: Rect): ActionTarget | undefined {
  const candidates = findByNames(elements, step.target.names);
  if (candidates.length === 0) return undefined;
  const score = (e: UiElement) => (roleMatches(e.role, step.target.role) ? 2 : 0) + (focus && intersects(e.bounds, focus) ? 1 : 0);
  const best = [...candidates].sort((a, b) => score(b) - score(a))[0];
  const confidence = roleMatches(best.role, step.target.role) ? best.confidence : best.confidence * ROLE_MISMATCH_PENALTY;
  const label = step.target.label ?? best.name;
  // A whole file list is too big to point at: one of the learner's selected files is what they act on.
  const selected = step.target.prefer === "selected" ? firstSelectedIn(best, elements) : undefined;
  if (selected) return { elementId: selected.id, bounds: selected.bounds, confidence: Math.min(confidence, selected.confidence), label };
  return { elementId: best.id, bounds: best.bounds, confidence, label };
}

function guideStep(context: TeachingContext, step: TaskStep): TeachingAction {
  const level = context.assistanceLevel;
  const target = locateTarget(step, context.observation.elements, context.focusRegion?.shape.bounds);
  if (!target) {
    const phone = context.pack?.surface === "phone";
    // On the phone the learner has usually left the page the target is on: the correction still helps.
    // On Windows, clarify lets the vision model try to locate the target before Hodey gives up on it.
    if (phone && context.correction) return { kind: "correct", speech: context.correction, skill: step.skill, assistanceLevel: level };
    const words = spoken(context.language);
    const speech = phone ? words.clarifyPhone : words.clarify;
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
/** "Where is…?" in English, Hindi and Roman Hinglish: pointing at the control is the whole answer. */
const WHERE_QUESTION = /\b(?:where|where's|which (?:one|button|tab|menu)|find)\b|कहाँ|कहां|किधर|\bkahan\b|\bkahaan\b|\bkidhar\b/i;

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
  if (!named) return { kind: "answer", speech: spoken(context.language).needVisionToAnswer, skill, assistanceLevel: level };
  const target = { elementId: named.id, bounds: named.bounds, confidence: named.confidence, label: named.name };
  // A where-question is fully answered by pointing; "what does it do?" still needs the vision model.
  return { kind: "answer", speech: spoken(context.language).itsHere(named.name), target, skill, assistanceLevel: level, final: WHERE_QUESTION.test(utterance) };
}

/** Prefer the smallest element whose centre is inside the mark — a button over the pane that contains it. */
function pickMarkedElement(elements: UiElement[], region: Rect): UiElement | undefined {
  const inside = elements.filter((e) => containsPoint(region, center(e.bounds)));
  const pool = inside.length > 0 ? inside : elements.filter((e) => intersects(e.bounds, region));
  return [...pool].sort((a, b) => area(a.bounds) - area(b.bounds))[0];
}

/** What a marked control is; `fromLesson` when the pack's own explanation says it (a complete answer). */
function describe(element: UiElement, context: TeachingContext): { speech: string; fromLesson: boolean } {
  const matches = (step: TaskStep) => step.target.names.some((n) => nameMatches(n, element.name));
  const packStep = context.pack?.steps.find(matches);
  const say = spoken(context.language);
  const base = packStep ? say.thatsControl(element.name, packStep.explain) : say.thatsElement(element.name, element.role);
  const isCurrentTarget = context.step !== undefined && matches(context.step);
  return { speech: isCurrentTarget ? `${base} ${say.neededForThisStep}` : base, fromLesson: packStep !== undefined };
}

function answerAbout(context: TeachingContext, annotation: LearnerAnnotation): TeachingAction {
  const element = pickMarkedElement(context.observation.elements, annotation.shape.bounds);
  const skill = context.step?.skill ?? GENERAL_SKILL;
  const level = context.assistanceLevel;
  if (!element) return { kind: "answer", speech: spoken(context.language).nothingMarked, skill, assistanceLevel: level };
  const { speech, fromLesson } = describe(element, context);
  const target = { elementId: element.id, bounds: element.bounds, confidence: element.confidence, label: element.name };
  return { kind: "answer", speech, target, skill, assistanceLevel: level, final: fromLesson };
}
