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
  // "new tab" is a button and "close this tab" a button inside the tab: neither asks for a tab item.
  [/(?<!\bnew |\bclose (?:this |the |that |a |my )?)\btabs?\b/, ["tab item", "sheet tab"]],
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
/** A whole name said as a phrase ("new tab") counts even when each of its words is short. */
const MIN_PHRASE_CHARS = 3;
const PHRASE_PADDING = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "my", "your", "this", "that"]);
/** Region names are short ("tab", "bar"), so their words count from three letters. */
const MIN_REGION_WORD_CHARS = 3;
const FILLER = new Set(["where", "what", "show", "this", "that", "these", "those", "does", "with", "have", "from", "there", "here", "which", "about", "find", "please", "tell", "able"]);
/** How far (row-weighted px) a pick of the wrong kind may move to reach the asked kind of control. */
const MAX_RETARGET_PX = 400;
/** Rows matter more than columns: the asked control usually sits on the same row as the model's pick. */
const ROW_WEIGHT = 3;
/** A model box this close to its numbered pick still agrees with it. */
const AGREEMENT_SLOP_PX = 8;

/** Browsers append a changing memory note to tab names ("New Tab - Memory usage - 39.4 MB"). */
const VOLATILE_SUFFIX = /\s+-\s+(?:high\s+)?memory usage\s+-\s+[\d.,]+\s?[kmg]b$/i;
/** A label Hodey quoted in its speech: 'New Tab', "Close", “Close”, not the apostrophe in "it's". */
const QUOTED = /(?:^|[^\p{L}\p{N}])['"‘“]([^'"‘’“”\n]{2,60})['"’”](?=$|[^\p{L}\p{N}])/gu;

/** The window's own buttons. Their region says so; an older screen read only shows where they sit. */
const CAPTION_NAMES = new Set(["minimize", "maximize", "restore", "restore down", "close"]);
const CAPTION_REGION = "title bar";
/** A maximized window's frame hangs off-screen, so its buttons sit a little below its top edge. */
const CAPTION_TOP_SLOP_PX = 40;
/** Minimize, Maximize and Close together span about 300 px at 200 % scaling. */
const CAPTION_RIGHT_REACH_PX = 320;
/** Learner words about the window itself, which make its own buttons the likely target. */
const WINDOW_WORDS =
  /\b(minimi[sz]e|maximi[sz]e|restore|full ?screen|resize|shrink|title ?bar|window)\b|\b(close|quit|exit|shut)\b.{0,16}\b(app|application|program|browser)\b/i;

/** The kinds of control the learner's words name ("the slider" → slider). */
export function askedRoles(utterance: string | undefined): string[] {
  if (!utterance) return [];
  const said = utterance.toLowerCase();
  return ROLE_WORDS.filter(([words]) => words.test(said)).flatMap(([, roles]) => roles);
}

/** A control's name without the parts that change between reads. */
export function stableName(name: string): string {
  return name.replace(VOLATILE_SUFFIX, "").trim();
}

/** Lowercase words separated by single spaces, for comparing names however they're written. */
function norm(text: string): string {
  return stableName(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_TOKEN_CHARS && !FILLER.has(word));
}

/** A name worth matching as a phrase: one word ("VPN"), or two or more that aren't just "the"/"a" padding. */
function phraseWorthy(name: string): boolean {
  const words = name.split(" ").filter((word) => word.length > 0);
  const content = words.filter((word) => !PHRASE_PADDING.has(word));
  return name.length >= MIN_PHRASE_CHARS && (content.length >= 2 || (words.length === 1 && content.length === 1));
}

/** Whether `text` says `name` whole, as a phrase ("open new tab" says "New Tab"). */
export function saysName(name: string, text: string | undefined): boolean {
  const said = norm(name);
  return text !== undefined && phraseWorthy(said) && ` ${norm(text)} `.includes(` ${said} `);
}

/** Points for matching what the learner asked: the kind of control they named, and words of its name. */
export function utterancePoints(element: UiElement, utterance: string | undefined): number {
  if (!utterance) return 0;
  let points = askedRoles(utterance).includes(element.role) ? ROLE_POINTS : 0;
  const said = new Set(tokens(utterance));
  if (saysName(element.name, utterance) || tokens(element.name).some((word) => said.has(word))) points += NAME_POINTS;
  return points;
}

/** The control labels Hodey quoted in its speech, in order. */
export function quotedLabels(speech: string): string[] {
  return [...speech.matchAll(QUOTED)].map((match) => match[1].trim()).filter((label) => label !== "");
}

/** 3 = exactly the name, 2 = the same words, 1 = some of its words ("search bar"), 0 = no match. */
export type LabelTier = 0 | 1 | 2 | 3;

export function labelTier(label: string, name: string): LabelTier {
  const said = norm(label);
  if (!said) return 0;
  if (label.trim() === name.trim()) return 3;
  const named = norm(name);
  if (said === named) return 2;
  const words = new Set(named.split(" "));
  return said.split(" ").every((word) => words.has(word)) ? 1 : 0;
}

/** Minimize, Maximize/Restore or Close of the window itself (not a tab's Close). */
export function isWindowCaption(element: UiElement, window?: Rect): boolean {
  if (!CAPTION_NAMES.has(norm(element.name))) return false;
  if (element.container === CAPTION_REGION) return true;
  if (!window || element.container?.startsWith("tab ")) return false;
  const fromRight = window.x + window.width - (element.bounds.x + element.bounds.width);
  return Math.abs(element.bounds.y - window.y) <= CAPTION_TOP_SLOP_PX && fromRight <= CAPTION_RIGHT_REACH_PX;
}

/** The learner is asking about the window itself (minimize it, close the app), not something inside it. */
export function asksAboutWindow(text: string | undefined): boolean {
  return text !== undefined && WINDOW_WORDS.test(text);
}

const isPointableRole = (element: UiElement) => POINTABLE_ROLES.has(element.role);

/** The smallest pointable control under `at`, if any. */
function controlAt(at: Point, elements: UiElement[], pointable: (element: UiElement) => boolean): UiElement | undefined {
  return elements
    .filter((e) => pointable(e) && containsPoint(e.bounds, at))
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
  /** What may be pointed at; POINTABLE_ROLES unless the surface says otherwise (the phone's OCR text). */
  pointable?: (element: UiElement) => boolean;
}

/**
 * Checks the model's pick against the screen: its box wins over a numbered pick it doesn't cover (small
 * models miscount), a box alone snaps to the control under it, and a pick of the wrong kind ("Mute app"
 * for "the slider") moves to the asked kind of control beside it, unless the learner named the pick itself.
 */
export function groundTarget({ chosen, box, elements, utterance, pointable = isPointableRole }: GroundingInput): UiElement | undefined {
  let target = chosen;
  if (box) {
    const at = center(box);
    const under = controlAt(at, elements, pointable);
    const agrees = target !== undefined && containsPoint(padRect(target.bounds, AGREEMENT_SLOP_PX), at);
    if (under && !agrees) target = under;
  }
  const roles = askedRoles(utterance);
  if (!target || roles.length === 0 || roles.includes(target.role) || saysName(target.name, utterance)) return target;
  return nearestOfRole(target, roles, elements) ?? target;
}

/** How the target was settled, from strongest (two signals agree on the named control) to weakest. */
export type Agreement = "index+label" | "box+label" | "label" | "label-ambiguous" | "index+box" | "box" | "index-unconfirmed" | "legacy" | "none";

export interface Resolution {
  element?: UiElement;
  /** A bare box when no listed control is the target. */
  box?: Rect;
  agreement: Agreement;
  /** How well the label matched the element's name. */
  tier?: LabelTier;
}

export interface ResolveInput extends GroundingInput {
  /** Names the model gave for its target, best first: target_label, then labels quoted in its speech. */
  labels: string[];
  /** The learner's window, to tell its own buttons apart when the screen read has no regions. */
  window?: Rect;
}

/** The pointable controls whose names match `label` best. */
function bestMatches(label: string, elements: UiElement[]): { matches: UiElement[]; tier: LabelTier } {
  const scored = elements.map((element) => ({ element, tier: labelTier(label, element.name) }));
  const tier = Math.max(0, ...scored.map((s) => s.tier)) as LabelTier;
  return { matches: tier === 0 ? [] : scored.filter((s) => s.tier === tier).map((s) => s.element), tier };
}

/** Keeps the elements that pass `test`, unless none do. */
function prefer(pool: UiElement[], test: (element: UiElement) => boolean): UiElement[] {
  const kept = pool.filter(test);
  return kept.length > 0 ? kept : pool;
}

function regionWords(text: string): Set<string> {
  return new Set(norm(text).split(" ").filter((word) => word.length >= MIN_REGION_WORD_CHARS && !FILLER.has(word)));
}

/** Same-named controls (a tab's Close and the window's Close): the box, then the window rule, then the region the learner named. */
function narrow(matches: UiElement[], { box, utterance, window }: ResolveInput): UiElement[] {
  let pool = matches;
  if (box) pool = prefer(pool, (e) => containsPoint(padRect(e.bounds, AGREEMENT_SLOP_PX), center(box)));
  const aboutWindow = asksAboutWindow(utterance);
  pool = prefer(pool, (e) => isWindowCaption(e, window) === aboutWindow);
  const said = regionWords(utterance ?? "");
  pool = prefer(pool, (e) => e.container !== undefined && [...regionWords(e.container)].some((word) => said.has(word)));
  if (!box) return pool;
  return [...pool].sort((a, b) => rowDistance(a.bounds, box) - rowDistance(b.bounds, box));
}

function pickAmong(matches: UiElement[], under: UiElement | undefined, input: ResolveInput): Resolution {
  const { chosen } = input;
  const pool = matches.length === 1 ? matches : narrow(matches, input);
  if (chosen && pool.includes(chosen)) return { element: chosen, agreement: "index+label" };
  if (under && pool.includes(under)) return { element: under, agreement: "box+label" };
  return { element: pool[0], agreement: pool.length === 1 ? "label" : "label-ambiguous" };
}

/** The model named a control that isn't listed: its box (the control may be unreadable) beats an index the name contradicts. */
function unmatched({ chosen, box }: ResolveInput, under: UiElement | undefined): Resolution {
  if (box && chosen && under === chosen) return { element: chosen, agreement: "index+box" };
  if (box) return { box, agreement: "box" };
  if (chosen) return { element: chosen, agreement: "index-unconfirmed" };
  return { agreement: "none" };
}

/**
 * Settles what the model pointed at, by name first: the index or box is trusted only when it agrees
 * with the control the model named. Without any name, falls back to the box and role checks.
 */
export function resolveTarget(input: ResolveInput): Resolution {
  const pointable = input.pointable ?? isPointableRole;
  const under = input.box ? controlAt(center(input.box), input.elements, pointable) : undefined;
  const choices = input.elements.filter(pointable);
  for (const label of input.labels) {
    const { matches, tier } = bestMatches(label, choices);
    if (matches.length > 0) return { ...pickAmong(matches, under, input), tier };
  }
  if (input.labels.length > 0) return unmatched(input, under);
  const element = groundTarget(input);
  if (element) return { element, agreement: "legacy" };
  return input.box ? { box: input.box, agreement: "box" } : { agreement: "none" };
}

/** Confidence from how the target was settled; the model's own number is constant and says nothing (always 0.95). */
const AGREEMENT_CONFIDENCE: Record<Agreement, number> = {
  "index+label": 0.95,
  "box+label": 0.9,
  label: 0.88,
  "label-ambiguous": 0.75,
  "index+box": 0.8,
  box: 0.8,
  "index-unconfirmed": 0.6,
  legacy: 0.9,
  none: 0,
};

/** A label that only shares some words with the name is weaker evidence. */
const WORD_MATCH_CONFIDENCE: Partial<Record<Agreement, number>> = { "index+label": 0.85, "box+label": 0.8, label: 0.75 };

export function agreementConfidence(resolution: Resolution): number {
  const { agreement, tier, element } = resolution;
  const settled = (tier === 1 ? WORD_MATCH_CONFIDENCE[agreement] : undefined) ?? AGREEMENT_CONFIDENCE[agreement];
  return element ? Math.min(settled, element.confidence) : settled;
}
