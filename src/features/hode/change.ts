import type { ActionSummary, ActionVerdict, ControlRef, Rect, ScreenChange, ScreenObservation, TaskStep, UiElement } from "../../lib/types";
import { findByNames, nameMatches } from "./signals";
import { clickedControl, wrongControl, type StepAction } from "./stuck";

/** Bounds may jitter this much between reads (DPI rounding, OCR boxes) without counting as a move. */
export const BOUNDS_TOLERANCE_PX = 4;
/** This many controls appearing or disappearing at once is a new view (a ribbon tab, a pane), not noise. */
export const STRUCTURAL_CHANGE_MIN = 3;
/** Actions passed to the reasoner; enough to see a pattern, small enough to stay cheap. */
export const RECENT_ACTIONS = 3;
/** Controls named per kind of change in a summary; the rest are counted. */
const MAX_LISTED = 4;
/** Shown by hovering alone, so they never mean the learner did something. */
const TRANSIENT_ROLES = new Set(["tool tip", "tooltip"]);
/** Opening or closing one of these changes what the learner can do next. */
const POPUP_ROLES = new Set(["dialog", "window", "menu"]);

const keyOf = (e: UiElement) => `${e.role.toLowerCase()}\n${e.name}`;
const refOf = (e: UiElement): ControlRef => ({ role: e.role, name: e.name });

function group(observation: ScreenObservation): Map<string, UiElement[]> {
  const groups = new Map<string, UiElement[]>();
  for (const element of observation.elements) {
    if (TRANSIENT_ROLES.has(element.role.toLowerCase())) continue;
    const key = keyOf(element);
    const same = groups.get(key);
    if (same) same.push(element);
    else groups.set(key, [element]);
  }
  return groups;
}

function movedBeyondTolerance(a: Rect, b: Rect): boolean {
  return [a.x - b.x, a.y - b.y, a.width - b.width, a.height - b.height].some((delta) => Math.abs(delta) > BOUNDS_TOLERANCE_PX);
}

const emptyChange = (windowChanged: boolean): ScreenChange => ({ windowChanged, appeared: [], disappeared: [], selected: [], deselected: [], moved: [] });

/** Compares two reads by what the controls are (role and name), never by id, which changes between reads. */
export function diffScreens(before: ScreenObservation, after: ScreenObservation): ScreenChange {
  const change = emptyChange(before.app !== after.app || before.windowTitle !== after.windowTitle);
  const was = group(before);
  const now = group(after);
  for (const [key, earlier] of was) {
    const later = now.get(key) ?? [];
    earlier.slice(later.length).forEach((e) => change.disappeared.push(refOf(e)));
    later.slice(earlier.length).forEach((e) => change.appeared.push(refOf(e)));
    earlier.slice(0, later.length).forEach((e, i) => comparePair(e, later[i], change));
  }
  for (const [key, later] of now) if (!was.has(key)) later.forEach((e) => change.appeared.push(refOf(e)));
  return change;
}

function comparePair(before: UiElement, after: UiElement, change: ScreenChange): void {
  if ((before.selected === true) !== (after.selected === true)) (after.selected ? change.selected : change.deselected).push(refOf(after));
  if (movedBeyondTolerance(before.bounds, after.bounds)) change.moved.push(refOf(after));
}

export function isUnchanged(change: ScreenChange): boolean {
  const { windowChanged, ...lists } = change;
  return !windowChanged && Object.values(lists).every((list) => list.length === 0);
}

const isTarget = (step: TaskStep | undefined, ref: ControlRef) => step?.target.names.some((name) => nameMatches(name, ref.name)) ?? false;

function targetVerdict(action: StepAction & { before: ScreenObservation }, change: ScreenChange, step: TaskStep | undefined): ActionVerdict | undefined {
  if (!step) return undefined;
  const before = findByNames(action.before.elements, step.target.names).length;
  const after = findByNames(action.after.elements, step.target.names).length;
  if (before === 0 && after > 0) return "progress";
  if (before > 0 && after === 0) return "off_track";
  if (change.deselected.some((ref) => isTarget(step, ref))) return "off_track";
  return undefined;
}

/** A change that matters whatever the step: popups, selection, a new view, undo/back, a click on another control. */
function offTrack(action: StepAction, change: ScreenChange, step: TaskStep | undefined): boolean {
  const popup = [...change.appeared, ...change.disappeared].some((ref) => POPUP_ROLES.has(ref.role.toLowerCase()));
  const selection = change.selected.length + change.deselected.length > 0;
  const structural = change.appeared.length + change.disappeared.length >= STRUCTURAL_CHANGE_MIN;
  const inputs = action.after.inputs ?? [];
  const undone = inputs.some((input) => input.kind === "undo" || input.kind === "back");
  // Enter sends or confirms something: worth a fresh look even when the read shows little change yet.
  const submitted = inputs.some((input) => input.kind === "submit");
  const strayClick = step ? wrongControl(action, step) !== undefined : clickedControl(action) !== undefined;
  return popup || selection || structural || undone || submitted || strayClick;
}

/**
 * How one learner action bears on the current step (or on an open-ended Hode, with no step). Only
 * `progress` and `off_track` are worth reasoning about; `unchanged` and `noise` leave guidance as it is.
 */
export function assessAction(action: StepAction, step?: TaskStep): ActionVerdict {
  const before = action.before;
  if (!before) return "off_track";
  const change = diffScreens(before, action.after);
  if (change.windowChanged) return "off_track";
  const target = targetVerdict({ ...action, before }, change, step);
  if (target) return target;
  if (offTrack(action, change, step)) return "off_track";
  if (change.moved.some((ref) => isTarget(step, ref))) return "progress";
  return isUnchanged(change) ? "unchanged" : "noise";
}

/** True for actions worth a new look by the reasoner. */
export const mattered = (verdict: ActionVerdict): boolean => verdict === "progress" || verdict === "off_track";

/** How a control appears in a summary; `undefined` leaves it out (counted instead). */
export type ControlLabel = (ref: ControlRef) => string | undefined;

const plainLabel: ControlLabel = (ref) => `${ref.role} "${ref.name}"`;

function listed(kind: string, refs: ControlRef[], label: ControlLabel): { part?: string; hidden: number } {
  const shown = refs.map(label).filter((text): text is string => text !== undefined);
  const hidden = refs.length - shown.length;
  if (shown.length === 0) return { hidden };
  const more = shown.length > MAX_LISTED ? ` (+${shown.length - MAX_LISTED} more)` : "";
  return { part: `${kind}${shown.slice(0, MAX_LISTED).join(", ")}${more}`, hidden };
}

/** A short line for the reasoner: what changed on screen. `label` decides what may be named. */
export function describeChange(change: ScreenChange, label: ControlLabel = plainLabel): string {
  if (isUnchanged(change)) return "nothing changed";
  const pieces = [
    listed("selected ", change.selected, label),
    listed("deselected ", change.deselected, label),
    listed("appeared: ", change.appeared, label),
    listed("gone: ", change.disappeared, label),
    listed("moved: ", change.moved, label),
  ];
  const parts = pieces.flatMap(({ part }) => (part ? [part] : []));
  const hidden = pieces.reduce((sum, { hidden }) => sum + hidden, 0);
  if (change.windowChanged) parts.unshift("switched window");
  if (hidden > 0) parts.push(`${hidden} other item${hidden === 1 ? "" : "s"} changed`);
  return parts.join("; ");
}

/** A control the label leaves out is still described by its kind ("a list item"). */
const kindOf = (ref: ControlRef) => `a ${ref.role.replace(/[^\p{L}\p{N} ]/gu, "").trim() || "control"}`;

function whatWasDone(action: ActionSummary, label: ControlLabel): string {
  if (action.clicked) return `click on ${label(action.clicked) ?? kindOf(action.clicked)}`;
  return action.inputs.length > 0 ? action.inputs.join(", ") : "a key press or screen change";
}

/** One numbered line per recent action, oldest first: what the learner did and what it changed. */
export function describeActions(actions: ActionSummary[], label: ControlLabel = plainLabel): string[] {
  return actions.map((action, i) => `${i + 1}. ${whatWasDone(action, label)}: ${describeChange(action.change, label)}`);
}

/** The last few actions of the step, oldest first, for the reasoner's context. */
export function summarizeActions(actions: StepAction[], step?: TaskStep): ActionSummary[] {
  return actions.slice(-RECENT_ACTIONS).map((action) => {
    const clicked = clickedControl(action);
    return {
      inputs: (action.after.inputs ?? []).map((input) => input.kind),
      ...(clicked ? { clicked: refOf(clicked) } : {}),
      change: action.before ? diffScreens(action.before, action.after) : emptyChange(false),
      verdict: assessAction(action, step),
    };
  });
}
