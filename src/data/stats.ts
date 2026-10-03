import type { SkillRecord } from "../lib/types";
import type { HodeRecord, LearningStats } from "./types";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

function dayIndex(iso: string): number {
  const d = new Date(iso);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

/** Consecutive local days with a completed Hode, counting back from today (or yesterday, so a streak survives until midnight). */
export function streakDays(hodes: HodeRecord[], now: Date): number {
  const days = new Set(hodes.filter((h) => h.outcome === "completed" && h.endedAt).map((h) => dayIndex(h.endedAt as string)));
  let day = dayIndex(now.toISOString());
  if (!days.has(day)) day -= 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export function computeStats(hodes: HodeRecord[], skills: SkillRecord[], now: Date): LearningStats {
  const minutes = hodes.reduce((sum, h) => (h.endedAt ? sum + (Date.parse(h.endedAt) - Date.parse(h.startedAt)) / MS_PER_MINUTE : sum), 0);
  return {
    hodesCompleted: hodes.filter((h) => h.outcome === "completed").length,
    skillsMastered: skills.filter((s) => s.status === "mastered").length,
    skillsLearning: skills.filter((s) => s.status === "learning").length,
    streakDays: streakDays(hodes, now),
    minutesLearning: Math.round(minutes),
  };
}

export interface SkillGroup {
  /** "excel", "windows", … */
  app: string;
  skills: SkillRecord[];
}

/** Skills grouped by their app prefix, most-practised app first. */
export function groupSkills(skills: SkillRecord[]): SkillGroup[] {
  const groups = new Map<string, SkillRecord[]>();
  for (const skill of skills) {
    const app = skill.skill_id.split(".")[0];
    groups.set(app, [...(groups.get(app) ?? []), skill]);
  }
  return [...groups].map(([app, list]) => ({ app, skills: list.sort((a, b) => a.skill_id.localeCompare(b.skill_id)) })).sort((a, b) => b.skills.length - a.skills.length);
}

/** 0–1 progress toward mastery, from the help level Hodey currently gives. */
export function masteryOf(skill: SkillRecord): number {
  const LEVEL_PROGRESS = { demonstrate: 0.1, guide: 0.3, hint: 0.55, observe: 0.8, independent: 1 } as const;
  return LEVEL_PROGRESS[skill.last_assistance_level];
}
