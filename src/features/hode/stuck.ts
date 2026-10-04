import { area, center, containsPoint } from "../../lib/coords";
import type { LearnerInput, Point, ScreenObservation, StateSignal, TaskPack, TaskStep, UiElement } from "../../lib/types";
import { findByNames, nameMatches } from "./signals";

/** The third click in a row on the same wrong control. */
export const REPEAT_CLICK_LIMIT = 3;
/** Undo/back this many times in a row. */
export const UNDO_LOOP_LIMIT = 2;
/** Learner actions with the step's target nowhere on screen. */
export const ABSENT_ACTION_LIMIT = 3;
/** Learner actions remembered per step; enough for every pattern above. */
export const STEP_HISTORY_LIMIT = 8;

/** Big containers are never "the control" a click landed on. */
const CONTAINER_ROLES = new Set(["window", "pane", "dialog", "group", "document", "custom", "title bar", "tool bar"]);
const MENU_ROLE = "menu";
const DIALOG_ROLE = "dialog";
const WINDOW_ROLE = "window";

/** One learner action during a step: the screen it happened on, and the screen read after it. */
export interface StepAction {
  before?: ScreenObservation;
  after: ScreenObservation;
}

/** Why Hodey thinks the learner is stuck (PRD §7). `said_stuck`: "where?", "I don't see it". */
export type StuckSignal =
  | { kind: "repeated_click"; control: string }
  | { kind: "menu_loop"; menu: string }
  | { kind: "undo_loop" }
  | { kind: "surprise_dialog"; title: string }
  | { kind: "target_missing"; target: string }
  | { kind: "said_stuck" };

/** Appends an action, keeping only the last few. */
export function remember(history: StepAction[], action: StepAction): StepAction[] {
  return [...history, action].slice(-STEP_HISTORY_LIMIT);
}

/** Checks the step's recent actions (newest last) for a stuck pattern, most urgent first. */
export function detectStuck(history: StepAction[], step: TaskStep, pack?: TaskPack): StuckSignal | undefined {
  if (history.length === 0) return undefined;
  return surpriseDialog(history, step, pack) ?? undoLoop(history) ?? menuLoop(history, step) ?? repeatedClick(history, step) ?? targetMissing(history, step);
}

const targets = (step: TaskStep, observation: ScreenObservation) => findByNames(observation.elements, step.target.names);

function lastClick(observation: ScreenObservation): Point | undefined {
  const clicks = (observation.inputs ?? []).filter((i): i is Extract<LearnerInput, { kind: "click" }> => i.kind === "click");
  return clicks.at(-1)?.at;
}

/** The control a click landed on, if it isn't (inside) the step's target. Undefined for empty space. */
function wrongControl(action: StepAction, step: TaskStep): UiElement | undefined {
  const at = lastClick(action.after);
  if (!at) return undefined;
  const screen = action.before ?? action.after;
  if (targets(step, screen).some((t) => containsPoint(t.bounds, at))) return undefined;
  const hit = screen.elements.filter((e) => containsPoint(e.bounds, at)).sort((a, b) => area(a.bounds) - area(b.bounds))[0];
  return hit && !CONTAINER_ROLES.has(hit.role.toLowerCase()) ? hit : undefined;
}

function repeatedClick(history: StepAction[], step: TaskStep): StuckSignal | undefined {
  if (history.length < REPEAT_CLICK_LIMIT) return undefined;
  const controls = history.slice(-REPEAT_CLICK_LIMIT).map((a) => wrongControl(a, step));
  const first = controls[0];
  if (!first) return undefined;
  const same = controls.every((c) => c !== undefined && c.name === first.name && c.role === first.role);
  return same ? { kind: "repeated_click", control: first.name } : undefined;
}

/** Menus open on a screen that don't hold the step's target. */
function wrongMenus(observation: ScreenObservation, step: TaskStep): string[] {
  const goal = targets(step, observation);
  return observation.elements
    .filter((e) => e.role.toLowerCase() === MENU_ROLE && !goal.some((t) => containsPoint(e.bounds, center(t.bounds))))
    .map((e) => e.name);
}

const isOpen = (observation: ScreenObservation | undefined, menu: string) =>
  observation?.elements.some((e) => e.role.toLowerCase() === MENU_ROLE && e.name === menu) ?? false;

/** Open → closed → open again, ending with the newest screen. */
function menuLoop(history: StepAction[], step: TaskStep): StuckSignal | undefined {
  const screens = [history[0].before, ...history.map((a) => a.after)];
  for (const menu of wrongMenus(history[history.length - 1].after, step)) {
    const states = screens.map((s) => isOpen(s, menu));
    const closedAt = states.lastIndexOf(false);
    if (closedAt > 0 && states.slice(0, closedAt).includes(true)) return { kind: "menu_loop", menu };
  }
  return undefined;
}

function undoLoop(history: StepAction[]): StuckSignal | undefined {
  const newest = history[history.length - 1].after.inputs ?? [];
  if (!newest.some((i) => i.kind === "undo" || i.kind === "back")) return undefined;
  const recent = history.flatMap((a) => a.after.inputs ?? []).slice(-UNDO_LOOP_LIMIT);
  const looping = recent.length === UNDO_LOOP_LIMIT && recent.every((i) => i.kind === "undo" || i.kind === "back");
  return looping ? { kind: "undo_loop" } : undefined;
}

function signalNames(signal: StateSignal): string[] {
  return "names" in signal ? (signal.names ?? []) : [];
}

/** Every name the task expects to see, so its own dialogs are never a surprise. */
function expectedNames(step: TaskStep, pack?: TaskPack): string[] {
  return [step, ...(pack?.steps ?? [])].flatMap((s) => [...s.target.names, ...signalNames(s.success), ...s.mistakes.flatMap((m) => signalNames(m.signal))]);
}

/** Dialogs, and windows other than the app's own main window. */
function windowsOn(observation: ScreenObservation): UiElement[] {
  return observation.elements.filter((e) => {
    const role = e.role.toLowerCase();
    return role === DIALOG_ROLE || (role === WINDOW_ROLE && e.name !== observation.windowTitle);
  });
}

function surpriseDialog(history: StepAction[], step: TaskStep, pack?: TaskPack): StuckSignal | undefined {
  const earlier = [history[0].before, ...history.slice(0, -1).map((a) => a.after)].flatMap((s) => (s ? windowsOn(s) : []));
  const expected = expectedNames(step, pack);
  const surprise = windowsOn(history[history.length - 1].after).find(
    (w) => !earlier.some((e) => e.name === w.name) && !expected.some((n) => nameMatches(n, w.name)),
  );
  return surprise ? { kind: "surprise_dialog", title: surprise.name } : undefined;
}

function targetMissing(history: StepAction[], step: TaskStep): StuckSignal | undefined {
  if (history.length < ABSENT_ACTION_LIMIT) return undefined;
  const absent = history.slice(-ABSENT_ACTION_LIMIT).every((a) => targets(step, a.after).length === 0);
  return absent ? { kind: "target_missing", target: step.target.label ?? step.target.names[0] } : undefined;
}

/** True while a surprise dialog is still on screen. */
export function stillShowing(observation: ScreenObservation, title: string): boolean {
  return windowsOn(observation).some((w) => w.name === title);
}
