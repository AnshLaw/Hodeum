import type { SkillRecord } from "../lib/types";
import type { HodeRecord, LearningStats } from "./types";

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

function dayIndex(iso: string): number {
  const d = new Date(iso);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);
}

/**
 * Consecutive local days the learner practised (started a Hode, finished or not), counting back from today,
 * or from yesterday so a streak survives until midnight.
 */
export function streakDays(hodes: HodeRecord[], now: Date): number {
  const days = new Set(hodes.map((h) => dayIndex(h.startedAt)));
  let day = dayIndex(now.toISOString());
  if (!days.has(day)) day -= 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

const WEEK_DAYS = 7;

const minutesIn = (h: HodeRecord) => (h.endedAt ? (Date.parse(h.endedAt) - Date.parse(h.startedAt)) / MS_PER_MINUTE : 0);

export interface DayActivity {
  /** Local midnight of the day. */
  date: Date;
  minutes: number;
  hodes: number;
  completed: number;
  today: boolean;
}

/** The last seven local days, oldest first: time spent, Hodes started and finished, by the day each began. */
export function weekActivity(hodes: HodeRecord[], now: Date): DayActivity[] {
  const today = dayIndex(now.toISOString());
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const day = today - (WEEK_DAYS - 1 - i);
    const those = hodes.filter((h) => dayIndex(h.startedAt) === day);
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (WEEK_DAYS - 1 - i));
    return {
      date,
      minutes: Math.round(those.reduce((sum, h) => sum + minutesIn(h), 0)),
      hodes: those.length,
      completed: those.filter((h) => h.outcome === "completed").length,
      today: day === today,
    };
  });
}

export function computeStats(hodes: HodeRecord[], skills: SkillRecord[], now: Date): LearningStats {
  const minutes = hodes.reduce((sum, h) => sum + minutesIn(h), 0);
  return {
    hodesCompleted: hodes.filter((h) => h.outcome === "completed").length,
    skillsMastered: skills.filter((s) => s.status === "mastered").length,
    skillsLearning: skills.filter((s) => s.status === "learning").length,
    streakDays: streakDays(hodes, now),
    minutesLearning: Math.round(minutes),
  };
}

/** 0–1 progress toward mastery, from the help level Hodey currently gives. */
export function masteryOf(skill: SkillRecord): number {
  const LEVEL_PROGRESS = { demonstrate: 0.1, guide: 0.3, hint: 0.55, observe: 0.8, independent: 1 } as const;
  return LEVEL_PROGRESS[skill.last_assistance_level];
}
