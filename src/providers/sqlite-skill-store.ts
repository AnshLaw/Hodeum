import Database from "@tauri-apps/plugin-sql";
import { ASSISTANCE_LEVELS, type AssistanceLevel, type SkillRecord, type SkillStatus, type StepOutcome } from "../lib/types";
import { applyOutcome } from "../features/hode/policy";
import type { SkillStore } from "./interfaces";

/** Must match `DATABASE_URL` in src-tauri/src/db.rs, which owns the migrations. */
const DATABASE_URL = "sqlite:hodeum.db";
const SKILL_STATUSES: SkillStatus[] = ["new", "learning", "mastered"];

interface SkillRow {
  skill_id: string;
  status: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  last_assistance_level: string;
  last_seen_at: string;
}

function fromRow(row: SkillRow): SkillRecord {
  const level = row.last_assistance_level as AssistanceLevel;
  const status = row.status as SkillStatus;
  if (!ASSISTANCE_LEVELS.includes(level) || !SKILL_STATUSES.includes(status)) {
    throw new Error(`Corrupt skill row for ${row.skill_id}: status=${row.status}, level=${row.last_assistance_level}`);
  }
  return { ...row, status, last_assistance_level: level };
}

/** Local learner progress in SQLite (Tauri only). No screenshots or transcripts are stored. */
export class SqliteSkillStore implements SkillStore {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<SqliteSkillStore> {
    return new SqliteSkillStore(await Database.load(DATABASE_URL));
  }

  async get(skillId: string): Promise<SkillRecord | null> {
    const rows = await this.db.select<SkillRow[]>("SELECT * FROM skills WHERE skill_id = $1", [skillId]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async recordOutcome(skillId: string, outcome: StepOutcome): Promise<SkillRecord> {
    const now = new Date().toISOString();
    const next = applyOutcome(await this.get(skillId), skillId, outcome, now);
    await this.db.execute(
      `INSERT INTO skills (skill_id, status, confidence, success_count, failure_count, last_assistance_level, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(skill_id) DO UPDATE SET status = excluded.status, confidence = excluded.confidence,
         success_count = excluded.success_count, failure_count = excluded.failure_count,
         last_assistance_level = excluded.last_assistance_level, last_seen_at = excluded.last_seen_at`,
      [next.skill_id, next.status, next.confidence, next.success_count, next.failure_count, next.last_assistance_level, next.last_seen_at],
    );
    await this.db.execute(
      "INSERT INTO step_attempts (skill_id, completed, mistakes, level, escalated, at) VALUES ($1, $2, $3, $4, $5, $6)",
      [skillId, outcome.completed ? 1 : 0, outcome.mistakes, outcome.level, outcome.escalated ? 1 : 0, now],
    );
    return next;
  }
}
