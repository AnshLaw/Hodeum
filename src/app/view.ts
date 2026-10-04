import type { AssistanceLevel } from "../lib/types";
import type { HodeEventKind, HodeRecord } from "../data/types";
import type { HodeSummary } from "../lib/bus";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a date. */
export function timeAgo(iso: string, now: Date): string {
  const delta = now.getTime() - Date.parse(iso);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h ago`;
  if (delta < 2 * DAY) return "yesterday";
  if (delta < WEEK) return `${Math.floor(delta / DAY)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function durationLabel(hode: HodeRecord): string {
  if (!hode.endedAt) return "in progress";
  const minutes = Math.round((Date.parse(hode.endedAt) - Date.parse(hode.startedAt)) / MINUTE);
  return minutes < 1 ? "< 1 min" : `${minutes} min`;
}

const NOT_LIVE = new Set(["idle", "goal_entry", "success"]);

/** A Hode the learner can continue: it has a goal and is past goal entry but not finished. */
export function isLiveHode(summary: HodeSummary): boolean {
  return Boolean(summary.goal) && !NOT_LIVE.has(summary.phase);
}

export type OutcomeTone = "done" | "ended" | "live";

export function outcomeOf(hode: HodeRecord): { label: string; tone: OutcomeTone } {
  if (hode.outcome === "completed") return { label: "Completed", tone: "done" };
  if (hode.outcome === "ended") return { label: "Ended early", tone: "ended" };
  return { label: "In progress", tone: "live" };
}

/** Learner-facing names for the assistance ladder (PRD §5). */
export const LEVEL_LABELS: Record<AssistanceLevel, string> = {
  demonstrate: "Show me",
  guide: "Guide me",
  hint: "Hints only",
  observe: "Watch me",
  independent: "On my own",
};

export const EVENT_LABELS: Record<HodeEventKind, string> = {
  step_done: "Step done",
  hodey_step: "Hodey did this step",
  mistake: "Hodey corrected you",
  hint: "Asked for a hint",
  stuck: "Hodey stepped in",
  asked: "Asked about the screen",
  paused: "Paused",
};

export { suggestedPacks } from "../features/skills/graph";

/** "excel.pivot.create" -> "Create" within its group; the group header carries the app. */
export function skillTitle(skillId: string): string {
  const [, ...parts] = skillId.split(".");
  return parts.map((part) => part.replace(/_/g, " ")).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" › ");
}


export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
