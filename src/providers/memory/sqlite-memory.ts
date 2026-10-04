import type { SqlDatabase } from "../../data/sql";
import { ASSISTANCE_LEVELS, type AssistanceLevel } from "../../lib/types";
import type { HodeLearningSummary, LearningMemory, MemoryProvider, MemoryQuery } from "../interfaces";

/** At most this many memories reach the start of a Hode. */
export const MAX_RECALLED_MEMORIES = 6;
/** Recall looks through this many of the most recent summaries. */
const RECALL_SCAN_ROWS = 50;

export interface StoredSummary extends HodeLearningSummary {
  at: string;
}

interface SummaryRow {
  hode: string;
  completed: number;
  skills: string;
  needed_help_with: string;
  independent_steps: number;
  guided_steps: number;
  preferred_language: string;
  next_assistance_level: string;
  at: string;
}

const sameGoal = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function noteFor(summary: StoredSummary): string {
  const ending = summary.completed ? "Completed" : "Stopped";
  const help = summary.needed_help_with.length > 0 ? `; needed help with: ${summary.needed_help_with.join(", ")}` : "";
  return `${ending} "${summary.hode}": ${summary.independent_steps} steps alone, ${summary.guided_steps} guided${help}.`;
}

/** Each summary sharing a skill (or the goal) as memories of those skills, newest first, capped. */
export function recallFrom(stored: StoredSummary[], query: MemoryQuery, cap = MAX_RECALLED_MEMORIES): LearningMemory[] {
  const wanted = new Set(query.skillIds);
  return stored
    .flatMap((summary) => {
      const goalMatch = query.goal.trim() !== "" && sameGoal(summary.hode, query.goal);
      const skills = summary.skills_practiced.filter((skill) => goalMatch || wanted.has(skill));
      return skills.map((skillId) => ({ skillId, note: noteFor(summary), level: summary.next_assistance_level, at: summary.at }));
    })
    .slice(0, cap);
}

function stringList(json: string, column: string): string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`Corrupt learning summary ${column}: ${json}`);
  return value;
}

function summaryFromRow(row: SummaryRow): StoredSummary {
  const level = row.next_assistance_level as AssistanceLevel;
  if (!ASSISTANCE_LEVELS.includes(level)) throw new Error(`Corrupt learning summary level: ${row.next_assistance_level}`);
  return {
    hode: row.hode,
    completed: row.completed === 1,
    skills_practiced: stringList(row.skills, "skills"),
    needed_help_with: stringList(row.needed_help_with, "needed_help_with"),
    independent_steps: row.independent_steps,
    guided_steps: row.guided_steps,
    preferred_language: row.preferred_language,
    next_assistance_level: level,
    at: row.at,
  };
}

/** Skips a corrupt row (logged) instead of losing every memory. */
function readableSummaries(rows: SummaryRow[]): StoredSummary[] {
  return rows.flatMap((row) => {
    try {
      return [summaryFromRow(row)];
    } catch (error) {
      console.error("Ignoring an unreadable learning summary", error);
      return [];
    }
  });
}

/** Local learning memory (the source of truth, PRD §18.1). Stores the compact summary only. */
export class SqliteMemoryProvider implements MemoryProvider {
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async storeLearningSummary(s: HodeLearningSummary): Promise<void> {
    await this.db.execute(
      `INSERT INTO learning_summaries (hode, completed, skills, needed_help_with, independent_steps, guided_steps, preferred_language, next_assistance_level, at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [s.hode, s.completed ? 1 : 0, JSON.stringify(s.skills_practiced), JSON.stringify(s.needed_help_with), s.independent_steps, s.guided_steps, s.preferred_language, s.next_assistance_level, this.now()],
    );
  }

  async getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]> {
    const rows = await this.db.select<SummaryRow[]>("SELECT * FROM learning_summaries ORDER BY at DESC, id DESC LIMIT $1", [RECALL_SCAN_ROWS]);
    return recallFrom(readableSummaries(rows), query);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.select("SELECT 1 FROM learning_summaries LIMIT 1");
      return true;
    } catch (error) {
      console.error("Local learning memory is unavailable", error);
      return false;
    }
  }
}

/** The same memory kept in this window only: the browser stage, or when the database won't open. */
export class LocalMemoryProvider implements MemoryProvider {
  private readonly stored: StoredSummary[] = [];

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async storeLearningSummary(summary: HodeLearningSummary): Promise<void> {
    this.stored.unshift({ ...summary, at: this.now() });
    this.stored.length = Math.min(this.stored.length, RECALL_SCAN_ROWS);
  }

  async getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]> {
    return recallFrom(this.stored, query);
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
