import { nameMatches } from "../../features/hode/signals";
import type { TaskStep, UiElement } from "../../lib/types";
import { untrusted } from "../vision/prompt";

/** Shown instead of what a content control says (a file name, a list row, typed text). */
export const CONTENT_PLACEHOLDER = "(content hidden)";

/**
 * Controls whose names are the app's own interface labels ("Share", "Bold"). Every other role (list
 * and tree items, edits, text, links, title bars, and tabs, which name browser pages and sheets) can
 * hold the learner's files or words. A lesson's target is named by the lesson either way.
 */
const INTERFACE_ROLES = new Set([
  "button",
  "split button",
  "splitbutton",
  "menu item",
  "menu",
  "menu bar",
  "check box",
  "radio button",
  "combo box",
  "combobox",
  "tool bar",
  "toolbar",
  "slider",
  "spinner",
  "scroll bar",
]);

/** Runs of this many digits are account, phone or invoice numbers, not interface labels. */
const MIN_SECRET_DIGITS = 4;
const SCRUBS: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[a-z]:\\\S*/gi,
  /\\\\\S+/g,
  new RegExp(`\\d[\\d\\s-]{${MIN_SECRET_DIGITS - 2},}\\d`, "g"),
];

/** Interface labels can still carry an account ("Save to OneDrive - jane@…"): cut those parts out. */
export function scrub(text: string): string {
  const cleaned = SCRUBS.reduce((out, pattern) => out.replace(pattern, " "), text);
  return cleaned.replace(/\s+[-–—:|]\s*$/, "").replace(/\s+/g, " ").trim();
}

/**
 * What Gemini may read for one control: the lesson's own label when it's the step's target, the
 * scrubbed label for interface controls, and nothing for content.
 */
export function cloudName(element: UiElement, step: TaskStep | undefined): string {
  const target = step?.target.names.find((name) => nameMatches(name, element.name));
  if (target) return untrusted(step?.target.label ?? target.replace(/\*/g, ""));
  if (!INTERFACE_ROLES.has(element.role)) return CONTENT_PLACEHOLDER;
  return untrusted(scrub(element.name)) || CONTENT_PLACEHOLDER;
}
