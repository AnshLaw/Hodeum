import type { ActionTarget, Rect, TeachingContext, UiElement } from "../../lib/types";
import { agreementConfidence, labelTier, quotedLabels, resolveTarget, type LabelTier, type Resolution } from "./grounding";
import { pointable, windowBoundsOf } from "./prompt";
import type { MoreTarget } from "./schema";

/** A later control gets a number on screen only when grounding is at least this sure of it (a broad highlight's floor). */
export const MIN_MORE_TARGET_CONFIDENCE = 0.65;

/** Letters, combining marks (Devanagari vowel signs) and digits: what a mentioned word can't be cut out of. */
const WORD_CHAR = String.raw`[\p{L}\p{M}\p{N}]`;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** The learner's words grounding weighs: the question, else (in an open Hode) the goal they asked for. */
export function groundingUtterance(context: TeachingContext): string | undefined {
  return context.utterance ?? (context.openGoal ? context.goal : undefined);
}

/** A control the model named, settled as every target is: by its name first, checked against its number and box. */
export function resolveNamed(context: TeachingContext, pick: { chosen?: UiElement; box?: Rect; labels: string[] }): Resolution {
  const { elements } = context.observation;
  return resolveTarget({ ...pick, elements, utterance: groundingUtterance(context), window: windowBoundsOf(context), pointable: (e) => pointable(e, context) });
}

/** The words of `speech` that say one of `names` (whole words, any case), as written there. */
export function spokenMention(speech: string, names: (string | undefined)[]): string | undefined {
  for (const name of names) {
    const words = name?.trim();
    if (!words) continue;
    const said = new RegExp(`(?<!${WORD_CHAR})${words.replace(REGEX_SPECIALS, "\\$&")}(?!${WORD_CHAR})`, "iu").exec(speech);
    if (said) return said[0];
  }
  return undefined;
}

/** `target` with the words in the speech that name it, when the speech says one of `names`. */
export function withMention(target: ActionTarget, speech: string, names: (string | undefined)[]): ActionTarget {
  const mention = spokenMention(speech, names);
  return mention ? { ...target, mention } : target;
}

/** A later control's names, best first: its label, then the words in the speech that name it. */
export function namesOf(item: MoreTarget): string[] {
  const names = [item.label, item.mention ?? ""].map((name) => name.trim()).filter((name) => name !== "");
  return [...new Set(names)];
}

/** A quote names a later control when it has that control's words (any case), not just some of them. */
const SAME_WORDS: LabelTier = 2;

/**
 * The labels quoted in `speech` that don't name a later control. A step through several controls quotes
 * them all ("tick the box, then click 'OK'"), and only the first control's own words may settle it.
 */
export function firstQuotes(speech: string, later: MoreTarget[] = []): string[] {
  const names = later.flatMap(namesOf);
  return quotedLabels(speech).filter((quote) => !names.some((name) => labelTier(quote, name) >= SAME_WORDS));
}

export interface LaterInput {
  items: MoreTarget[];
  /** The step's first control; later ones are only lit beside it. */
  first?: ActionTarget;
  speech: string;
  /** The model's own confidence, which only ever caps what grounding found. */
  confidence: number;
  settle: (item: MoreTarget) => Resolution;
}

function laterTarget(item: MoreTarget, resolution: Resolution, { speech, confidence: cap }: LaterInput): ActionTarget | undefined {
  const { element } = resolution;
  // A bare box (no listed control) or nothing at all: a numbered ring there would be a guess.
  if (!element) return undefined;
  const confidence = Math.min(cap, agreementConfidence(resolution));
  if (confidence < MIN_MORE_TARGET_CONFIDENCE) return undefined;
  return withMention({ elementId: element.id, bounds: element.bounds, confidence, label: element.name }, speech, [item.mention, item.label, element.name]);
}

/**
 * The controls after the first that the step walks through, in flow order, each settled like the first.
 * Left out: one with no name (its number or box alone would be numbered as surely as a named one), the
 * first control or an earlier one named again, one nothing on screen fits, and one grounding isn't sure
 * enough to number. None at all without a first control.
 */
export function laterTargets(input: LaterInput): ActionTarget[] {
  if (!input.first) return [];
  const lit = new Set([input.first.elementId]);
  const targets: ActionTarget[] = [];
  for (const item of input.items.filter((later) => namesOf(later).length > 0)) {
    const target = laterTarget(item, input.settle(item), input);
    if (!target || lit.has(target.elementId)) continue;
    lit.add(target.elementId);
    targets.push(target);
  }
  return targets;
}

/** The action's `targets` field: present only when a later control survived. */
export function targetsField(targets: ActionTarget[]): { targets?: ActionTarget[] } {
  return targets.length > 0 ? { targets } : {};
}
