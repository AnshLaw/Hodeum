import { center, containsPoint, intersects } from "../../lib/coords";
import type { Rect, TeachingContext, UiElement } from "../../lib/types";
import { nameMatches } from "../../features/hode/signals";
import { BOX_SCALE } from "./schema";
import type { CapturedFrame } from "./types";

/** Keeps the prompt (and image + text tokens) well inside the 8k context. */
export const MAX_CANDIDATES = 80;
/** Roles worth pointing a learner at; containers and plain text rarely are. */
const ACTIONABLE_ROLES = new Set([
  "button",
  "split button",
  "splitbutton",
  "tab item",
  "menu item",
  "check box",
  "radio button",
  "combo box",
  "combobox",
  "edit",
  "edit box",
  "list item",
  "tree item",
  "hyperlink",
  "link",
  "sheet tab",
]);

const SYSTEM_PROMPT = [
  "You are Hodey, a patient teaching companion inside Windows. You teach; you never do the task for the learner.",
  "You see a screenshot of the learner's app and a numbered list of its on-screen controls.",
  "Reply with JSON only. Keep speech to one or two short sentences, in plain words, quoting control labels exactly as they appear.",
  "Never say you clicked, typed, or did anything. Ask the learner to do it.",
  "Point at a control by its number in target_index. Use -1 and a bbox (0-1000, relative to the image) only if no listed control fits.",
  "If you can't tell what the learner needs, use kind \"clarify\" and ask one short question.",
  "Set confidence honestly: below 0.65 when unsure.",
].join(" ");

function score(element: UiElement, context: TeachingContext): number {
  const focus = context.focusRegion?.shape.bounds;
  const targetNames = context.step?.target.names ?? [];
  let points = ACTIONABLE_ROLES.has(element.role) ? 1 : 0;
  if (focus && intersects(element.bounds, focus)) points += 4;
  if (targetNames.some((name) => nameMatches(name, element.name))) points += 8;
  return points;
}

/** The controls the model may point at: the step's target and the marked region first, then actionable ones. */
export function selectCandidates(context: TeachingContext): UiElement[] {
  return [...context.observation.elements]
    .map((element, order) => ({ element, order, points: score(element, context) }))
    .filter(({ points }) => points > 0)
    .sort((a, b) => b.points - a.points || a.order - b.order)
    .slice(0, MAX_CANDIDATES)
    .map(({ element }) => element);
}

/** Screen rect -> 0–1000 box relative to the captured window. */
export function toImageBox(rect: Rect, frame: Rect): [number, number, number, number] {
  const fx = (x: number) => Math.round(((x - frame.x) / frame.width) * BOX_SCALE);
  const fy = (y: number) => Math.round(((y - frame.y) / frame.height) * BOX_SCALE);
  return [fx(rect.x), fy(rect.y), fx(rect.x + rect.width), fy(rect.y + rect.height)];
}

/** 0–1000 box relative to the captured window -> screen rect. */
export function fromImageBox(box: number[], frame: Rect): Rect {
  const [x1, y1, x2, y2] = box;
  const x = frame.x + (Math.min(x1, x2) / BOX_SCALE) * frame.width;
  const y = frame.y + (Math.min(y1, y2) / BOX_SCALE) * frame.height;
  return { x, y, width: (Math.abs(x2 - x1) / BOX_SCALE) * frame.width, height: (Math.abs(y2 - y1) / BOX_SCALE) * frame.height };
}

function taskLines(context: TeachingContext, frame: CapturedFrame): string[] {
  const lines = [`App: ${context.observation.app} — "${context.observation.windowTitle}".`];
  if (context.goal) lines.push(`The learner's goal: ${context.goal}.`);
  if (context.step) lines.push(`Current step: ${context.step.objective}. Expected labels: ${context.step.target.names.join(", ")}.`);
  lines.push(`How much help to give: ${context.assistanceLevel} (demonstrate = explicit, hint = a nudge without naming the control).`);
  if (context.correction) lines.push(`The learner just made a mistake: ${context.correction}`);
  const region = context.focusRegion;
  if (region?.intent === "ask") {
    const box = toImageBox(region.shape.bounds, frame.rect).join(", ");
    lines.push(`The learner marked the area [${box}] and asks: "${context.utterance ?? "What is this?"}". Answer about that area with kind "answer".`);
  } else {
    lines.push('Tell the learner the next thing to do with kind "guide".');
  }
  return lines;
}

function controlList(candidates: UiElement[], frame: CapturedFrame): string {
  return candidates
    .map((element, index) => `${index}. ${element.role} "${element.name}"${element.selected ? " (selected)" : ""} at [${toImageBox(element.bounds, frame.rect).join(", ")}]`)
    .join("\n");
}

/** OpenAI-style chat messages for llama-server, with the screenshot inline. */
export function buildMessages(context: TeachingContext, candidates: UiElement[], frame: CapturedFrame) {
  const text = [...taskLines(context, frame), "", "Controls:", controlList(candidates, frame) || "(none found)"].join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${frame.png}` } },
        { type: "text", text },
      ],
    },
  ];
}

/** Whether a point lies inside the captured window (used to reject boxes the model hallucinated off-window). */
export function insideFrame(rect: Rect, frame: Rect): boolean {
  return containsPoint(frame, center(rect));
}
