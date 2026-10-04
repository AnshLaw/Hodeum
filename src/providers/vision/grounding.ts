import { area, center, containsPoint, padRect } from "../../lib/coords";
import type { Point, Rect, UiElement } from "../../lib/types";

/** Roles worth pointing a learner at; containers and plain text rarely are. */
export const POINTABLE_ROLES = new Set([
  "button",
  "split button",
  "splitbutton",
  "toggle button",
  "app bar button",
  "toggle switch",
  "tab item",
  "menu item",
  "check box",
  "radio button",
  "combo box",
  "combobox",
  "edit",
  "edit box",
  "slider",
  "spinner",
  "list item",
  "tree item",
  "hyperlink",
  "link",
  "sheet tab",
]);

/** Words a learner uses for a kind of control, and the UI Automation roles they mean. */
const ROLE_WORDS: [RegExp, string[]][] = [
  [/\bslid(er|ers|e bar)\b/, ["slider"]],
  [/\b(toggle|switch)(es)?\b/, ["toggle switch", "toggle button", "check box"]],
  [/\b(check ?box(es)?|tick ?box(es)?)\b/, ["check box"]],
  [/\b(drop ?-?downs?|combo ?box(es)?)\b/, ["combo box", "combobox"]],
  [/\btabs?\b/, ["tab item", "sheet tab"]],
  [/\b(links?|hyperlinks?)\b/, ["hyperlink", "link"]],
  [/\b(text ?box(es)?|search ?box|input|field)\b/, ["edit", "edit box"]],
  [/\bmenus?\b/, ["menu item"]],
  [/\bradio\b/, ["radio button"]],
  [/\bbuttons?\b/, ["button", "split button", "splitbutton", "toggle button", "app bar button"]],
];

const ROLE_POINTS = 6;
const NAME_POINTS = 6;
/** Shorter words ("app", "the") match too many control names to say which one the learner means. */
const MIN_TOKEN_CHARS = 4;
const FILLER = new Set(["where", "what", "show", "this", "that", "these", "those", "does", "with", "have", "from", "there", "here", "which", "about", "find", "please", "tell", "able"]);
/** How far (row-weighted px) a pick of the wrong kind may move to reach the asked kind of control. */
const MAX_RETARGET_PX = 400;
/** Rows matter more than columns: the asked control usually sits on the same row as the model's pick. */
const ROW_WEIGHT = 3;
/** A model box this close to its numbered pick still agrees with it. */
const AGREEMENT_SLOP_PX = 8;

/** The kinds of control the learner's words name ("the slider" → slider). */
export function askedRoles(utterance: string | undefined): string[] {
  if (!utterance) return [];
  const said = utterance.toLowerCase();
  return ROLE_WORDS.filter(([words]) => words.test(said)).flatMap(([, roles]) => roles);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_TOKEN_CHARS && !FILLER.has(word));
}

/** Points for matching what the learner asked: the kind of control they named, and words of its name. */
export function utterancePoints(element: UiElement, utterance: string | undefined): number {
  if (!utterance) return 0;
  let points = askedRoles(utterance).includes(element.role) ? ROLE_POINTS : 0;
  const said = new Set(tokens(utterance));
  if (tokens(element.name).some((word) => said.has(word))) points += NAME_POINTS;
  return points;
}

/** The smallest pointable control under `at`, if any. */
function controlAt(at: Point, elements: UiElement[]): UiElement | undefined {
  return elements
    .filter((e) => POINTABLE_ROLES.has(e.role) && containsPoint(e.bounds, at))
    .sort((a, b) => area(a.bounds) - area(b.bounds))[0];
}

function rowDistance(a: Rect, b: Rect): number {
  const [p, q] = [center(a), center(b)];
  return Math.hypot(p.x - q.x, (p.y - q.y) * ROW_WEIGHT);
}

/** The nearest control of one of `roles` to `from`, within reach. */
function nearestOfRole(from: UiElement, roles: string[], elements: UiElement[]): UiElement | undefined {
  return elements
    .filter((e) => roles.includes(e.role))
    .map((e) => ({ e, distance: rowDistance(from.bounds, e.bounds) }))
    .filter(({ distance }) => distance <= MAX_RETARGET_PX)
    .sort((a, b) => a.distance - b.distance)[0]?.e;
}

export interface GroundingInput {
  /** The model's numbered pick. */
  chosen?: UiElement;
  /** Where the model says the control is (screen px). */
  box?: Rect;
  /** Everything the screen read found. */
  elements: UiElement[];
  utterance?: string;
}

/**
 * Checks the model's pick against the screen: its box wins over a numbered pick it doesn't cover (small
 * models miscount), a box alone snaps to the control under it, and a pick of the wrong kind ("Mute app"
 * for "the slider") moves to the asked kind of control beside it.
 */
export function groundTarget({ chosen, box, elements, utterance }: GroundingInput): UiElement | undefined {
  let target = chosen;
  if (box) {
    const at = center(box);
    const under = controlAt(at, elements);
    const agrees = target !== undefined && containsPoint(padRect(target.bounds, AGREEMENT_SLOP_PX), at);
    if (under && !agrees) target = under;
  }
  const roles = askedRoles(utterance);
  if (!target || roles.length === 0 || roles.includes(target.role)) return target;
  return nearestOfRole(target, roles, elements) ?? target;
}
