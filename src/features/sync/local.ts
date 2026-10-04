import type { SkillRecord } from "../../lib/types";
import type { SqlDatabase } from "../../data/sql";
import type { ChatMessage } from "../../data/types";
import type { RemoteChat, RemoteEvent, RemoteHode, RemoteMessage, Snapshot } from "./types";

interface HodeRow extends Omit<RemoteHode, "open"> {
  open: number;
}

interface EventRow extends Omit<RemoteEvent, "seq"> {
  id: number;
}

interface MessageRow extends Omit<RemoteMessage, "web"> {
  web: string | null;
}

function parseWeb(json: string | null, id: string): ChatMessage["web"] | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as ChatMessage["web"];
  } catch (error) {
    console.error(`Syncing chat message ${id} without its unreadable web sources`, error);
    return null;
  }
}

/** Numbers each Hode's events in the order they were logged. */
function withSeq(rows: EventRow[]): RemoteEvent[] {
  const next = new Map<string, number>();
  return rows.map(({ id: _id, ...row }) => {
    const seq = next.get(row.hode_id) ?? 0;
    next.set(row.hode_id, seq + 1);
    return { ...row, seq };
  });
}

/** Reads and writes the synced tables of the local SQLite database as cloud rows. */
export class SqliteSyncSource {
  constructor(private readonly db: SqlDatabase) {}

  async snapshot(): Promise<Snapshot> {
    const skills = await this.db.select<SkillRecord[]>("SELECT skill_id, status, confidence, success_count, failure_count, last_assistance_level, last_seen_at FROM skills ORDER BY skill_id");
    const hodes = await this.db.select<HodeRow[]>("SELECT id, goal, pack_id, open, started_at, ended_at, outcome FROM hodes ORDER BY started_at");
    const events = await this.db.select<EventRow[]>("SELECT id, hode_id, kind, detail, at FROM hode_events ORDER BY id");
    const chats = await this.db.select<RemoteChat[]>("SELECT id, title, created_at, updated_at FROM chats ORDER BY created_at");
    const messages = await this.db.select<MessageRow[]>("SELECT id, chat_id, role, content, context, web, at FROM chat_messages ORDER BY at, rowid");
    return {
      skills,
      hodes: hodes.map((h) => ({ ...h, open: h.open === 1 })),
      events: withSeq(events),
      chats,
      messages: messages.map((m) => ({ ...m, web: parseWeb(m.web, m.id) })),
    };
  }

  /** Writes rows chosen by `planPull`: skills are upserted, the rest are new. */
  async write(rows: Snapshot): Promise<void> {
    for (const s of rows.skills) {
      await this.db.execute(
        `INSERT INTO skills (skill_id, status, confidence, success_count, failure_count, last_assistance_level, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT(skill_id) DO UPDATE SET status = excluded.status, confidence = excluded.confidence,
           success_count = excluded.success_count, failure_count = excluded.failure_count,
           last_assistance_level = excluded.last_assistance_level, last_seen_at = excluded.last_seen_at`,
        [s.skill_id, s.status, s.confidence, s.success_count, s.failure_count, s.last_assistance_level, s.last_seen_at],
      );
    }
    for (const h of rows.hodes) {
      await this.db.execute("INSERT INTO hodes (id, goal, pack_id, open, started_at, ended_at, outcome) VALUES ($1, $2, $3, $4, $5, $6, $7)", [h.id, h.goal, h.pack_id, h.open ? 1 : 0, h.started_at, h.ended_at, h.outcome]);
    }
    for (const e of [...rows.events].sort((a, b) => a.seq - b.seq)) {
      await this.db.execute("INSERT INTO hode_events (hode_id, kind, detail, at) VALUES ($1, $2, $3, $4)", [e.hode_id, e.kind, e.detail, e.at]);
    }
    for (const c of rows.chats) {
      await this.db.execute("INSERT INTO chats (id, title, created_at, updated_at) VALUES ($1, $2, $3, $4)", [c.id, c.title, c.created_at, c.updated_at]);
    }
    for (const m of rows.messages) {
      await this.db.execute("INSERT INTO chat_messages (id, chat_id, role, content, context, web, at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [m.id, m.chat_id, m.role, m.content, m.context, m.web ? JSON.stringify(m.web) : null, m.at]);
    }
  }
}
