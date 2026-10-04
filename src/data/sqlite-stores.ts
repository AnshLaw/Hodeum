import { applyOutcome } from "../features/hode/policy";
import { ASSISTANCE_LEVELS, type AssistanceLevel, type SkillRecord, type SkillStatus, type StepOutcome } from "../lib/types";
import type { SkillStore } from "../providers/interfaces";
import { DEFAULT_SETTINGS, parseSettings, type Settings, type SettingsStore } from "./settings";
import type { SqlDatabase } from "./sql";
import type { ChatMessage, ChatRole, ChatStore, ChatThread, HodeDetail, HodeEventKind, HodeEventRecord, HodeOutcome, HodeRecord, LearningStore } from "./types";

const SKILL_STATUSES: SkillStatus[] = ["new", "learning", "mastered"];
const SETTINGS_KEY = "settings";

interface SkillRow {
  skill_id: string;
  status: string;
  confidence: number;
  success_count: number;
  failure_count: number;
  last_assistance_level: string;
  last_seen_at: string;
}

interface HodeRow {
  id: string;
  goal: string;
  pack_id: string | null;
  open: number;
  started_at: string;
  ended_at: string | null;
  outcome: string | null;
}

interface EventRow {
  hode_id: string;
  kind: string;
  detail: string | null;
  at: string;
}

interface ChatRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  context: string | null;
  web: string | null;
  at: string;
}

function skillFromRow(row: SkillRow): SkillRecord {
  const level = row.last_assistance_level as AssistanceLevel;
  const status = row.status as SkillStatus;
  if (!ASSISTANCE_LEVELS.includes(level) || !SKILL_STATUSES.includes(status)) {
    throw new Error(`Corrupt skill row for ${row.skill_id}: status=${row.status}, level=${row.last_assistance_level}`);
  }
  return { ...row, status, last_assistance_level: level };
}

/** Optional columns come back as null; records leave them out. */
const optional = <K extends string, V>(key: K, value: V | null): Partial<Record<K, V>> => (value === null ? {} : ({ [key]: value } as Record<K, V>));

function hodeFromRow(row: HodeRow): HodeRecord {
  return {
    id: row.id,
    goal: row.goal,
    ...optional("packId", row.pack_id),
    open: row.open === 1,
    startedAt: row.started_at,
    ...optional("endedAt", row.ended_at),
    ...optional("outcome", row.outcome as HodeOutcome | null),
  };
}

function eventFromRow(row: EventRow): HodeEventRecord {
  return { hodeId: row.hode_id, kind: row.kind as HodeEventKind, ...optional("detail", row.detail), at: row.at };
}

const chatFromRow = (row: ChatRow): ChatThread => ({ id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at });

function webFromColumn(json: string | null): ChatMessage["web"] | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as ChatMessage["web"];
  } catch (error) {
    console.error("Ignoring unreadable web sources on a chat message", error);
    return null;
  }
}

function messageFromRow(row: MessageRow): ChatMessage {
  return { id: row.id, chatId: row.chat_id, role: row.role as ChatRole, content: row.content, ...optional("context", row.context), ...optional("web", webFromColumn(row.web)), at: row.at };
}

/** Local learner progress (Tauri only). No screenshots, audio or transcripts are stored. */
export class SqliteSkillStore implements SkillStore {
  constructor(protected readonly db: SqlDatabase) {}

  async get(skillId: string): Promise<SkillRecord | null> {
    const rows = await this.db.select<SkillRow[]>("SELECT * FROM skills WHERE skill_id = $1", [skillId]);
    return rows[0] ? skillFromRow(rows[0]) : null;
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

export class SqliteLearningStore extends SqliteSkillStore implements LearningStore {
  async startHode(hode: HodeRecord): Promise<void> {
    await this.db.execute("INSERT INTO hodes (id, goal, pack_id, open, started_at) VALUES ($1, $2, $3, $4, $5)", [hode.id, hode.goal, hode.packId ?? null, hode.open ? 1 : 0, hode.startedAt]);
  }

  async logEvent(event: HodeEventRecord): Promise<void> {
    await this.db.execute("INSERT INTO hode_events (hode_id, kind, detail, at) VALUES ($1, $2, $3, $4)", [event.hodeId, event.kind, event.detail ?? null, event.at]);
  }

  async endHode(id: string, outcome: HodeOutcome, at: string): Promise<void> {
    await this.db.execute("UPDATE hodes SET outcome = $1, ended_at = $2 WHERE id = $3", [outcome, at, id]);
  }

  async listHodes(limit: number): Promise<HodeRecord[]> {
    const rows = await this.db.select<HodeRow[]>("SELECT * FROM hodes ORDER BY started_at DESC LIMIT $1", [limit]);
    return rows.map(hodeFromRow);
  }

  async getHode(id: string): Promise<HodeDetail | null> {
    const [row] = await this.db.select<HodeRow[]>("SELECT * FROM hodes WHERE id = $1", [id]);
    if (!row) return null;
    const events = await this.db.select<EventRow[]>("SELECT hode_id, kind, detail, at FROM hode_events WHERE hode_id = $1 ORDER BY id", [id]);
    return { ...hodeFromRow(row), events: events.map(eventFromRow) };
  }

  async listSkills(): Promise<SkillRecord[]> {
    const rows = await this.db.select<SkillRow[]>("SELECT * FROM skills ORDER BY skill_id");
    return rows.map(skillFromRow);
  }

  async setSkillLevel(skillId: string, level: AssistanceLevel): Promise<void> {
    const status: SkillStatus = level === "independent" ? "mastered" : "learning";
    const { rowsAffected } = await this.db.execute("UPDATE skills SET last_assistance_level = $1, status = $2 WHERE skill_id = $3", [level, status, skillId]);
    if (rowsAffected === 0) throw new Error(`Unknown skill: ${skillId}`);
  }

  async resetSkill(skillId: string): Promise<void> {
    await this.db.execute("DELETE FROM skills WHERE skill_id = $1", [skillId]);
  }
}

export class SqliteChatStore implements ChatStore {
  constructor(private readonly db: SqlDatabase) {}

  async listChats(): Promise<ChatThread[]> {
    const rows = await this.db.select<ChatRow[]>("SELECT * FROM chats ORDER BY updated_at DESC");
    return rows.map(chatFromRow);
  }

  async createChat(title: string, at: string): Promise<ChatThread> {
    const chat = { id: crypto.randomUUID(), title, createdAt: at, updatedAt: at };
    await this.db.execute("INSERT INTO chats (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)", [chat.id, title, at, at]);
    return chat;
  }

  async messages(chatId: string): Promise<ChatMessage[]> {
    const rows = await this.db.select<MessageRow[]>("SELECT * FROM chat_messages WHERE chat_id = $1 ORDER BY at, rowid", [chatId]);
    return rows.map(messageFromRow);
  }

  async append(message: ChatMessage): Promise<void> {
    await this.db.execute("INSERT INTO chat_messages (id, chat_id, role, content, context, web, at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [message.id, message.chatId, message.role, message.content, message.context ?? null, message.web ? JSON.stringify(message.web) : null, message.at]);
    await this.db.execute("UPDATE chats SET updated_at = $1 WHERE id = $2", [message.at, message.chatId]);
  }

  async deleteChat(chatId: string): Promise<void> {
    await this.db.execute("DELETE FROM chat_messages WHERE chat_id = $1", [chatId]);
    await this.db.execute("DELETE FROM chats WHERE id = $1", [chatId]);
  }
}

export class SqliteSettingsStore implements SettingsStore {
  constructor(private readonly db: SqlDatabase) {}

  async load(): Promise<Settings> {
    const [row] = await this.db.select<{ value: string }[]>("SELECT value FROM settings WHERE key = $1", [SETTINGS_KEY]);
    if (!row) return DEFAULT_SETTINGS;
    try {
      return parseSettings(JSON.parse(row.value));
    } catch (error) {
      console.error("Saved settings are unreadable; using defaults", error);
      return DEFAULT_SETTINGS;
    }
  }

  async save(settings: Settings): Promise<void> {
    const value = JSON.stringify(parseSettings(settings));
    await this.db.execute("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [SETTINGS_KEY, value]);
  }
}
