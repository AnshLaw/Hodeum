import type { SupabaseClient } from "@supabase/supabase-js";
import type { SkillRecord } from "../../lib/types";
import type { CommandCloud, CommandStatus, DeviceRow, PcCommand, RemoteChat, RemoteEvent, RemoteHode, RemoteMessage, RemoteSettings, Snapshot, SnapshotTable, SyncCloud, Tombstone } from "./types";

/** PostgREST returns at most this many rows per request by default. */
const PAGE_SIZE = 1000;
/** Keeps each upsert request comfortably small. */
const PUSH_CHUNK = 500;

const TABLE: Record<SnapshotTable, { name: string; conflict: string }> = {
  skills: { name: "skills", conflict: "user_id,skill_id" },
  hodes: { name: "hodes", conflict: "user_id,id" },
  events: { name: "hode_events", conflict: "user_id,hode_id,seq" },
  chats: { name: "chats", conflict: "user_id,id" },
  messages: { name: "chat_messages", conflict: "user_id,id" },
};

/** Postgres answers `2026-10-03T10:00:00+00:00`; local rows use `toISOString()`. Compare like with like. */
const iso = (value: string): string => new Date(value).toISOString();
const isoOrNull = (value: string | null): string | null => (value === null ? null : iso(value));

const NORMALIZE: { [T in SnapshotTable]: (row: Snapshot[T][number]) => Snapshot[T][number] } = {
  skills: (r: SkillRecord) => ({ skill_id: r.skill_id, status: r.status, confidence: r.confidence, success_count: r.success_count, failure_count: r.failure_count, last_assistance_level: r.last_assistance_level, last_seen_at: iso(r.last_seen_at) }),
  hodes: (r: RemoteHode) => ({ id: r.id, goal: r.goal, pack_id: r.pack_id, open: r.open, started_at: iso(r.started_at), ended_at: isoOrNull(r.ended_at), outcome: r.outcome }),
  events: (r: RemoteEvent) => ({ hode_id: r.hode_id, seq: r.seq, kind: r.kind, detail: r.detail, at: iso(r.at) }),
  chats: (r: RemoteChat) => ({ id: r.id, title: r.title, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }),
  messages: (r: RemoteMessage) => ({ id: r.id, chat_id: r.chat_id, role: r.role, content: r.content, context: r.context, web: r.web, at: iso(r.at) }),
};

const normalizeCommand = (r: PcCommand): PcCommand => ({ id: r.id, device_id: r.device_id, kind: r.kind, goal: r.goal, status: r.status, detail: r.detail, created_at: iso(r.created_at) });

function check<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

const chunks = <T>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

/** One learner's account data over Supabase. Row Level Security limits every query to them. */
export class SupabaseCloud implements SyncCloud, CommandCloud {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async pull(): Promise<Snapshot> {
    const out = {} as Snapshot;
    for (const table of Object.keys(TABLE) as SnapshotTable[]) {
      const normalize = NORMALIZE[table] as (row: unknown) => unknown;
      (out[table] as unknown[]) = (await this.selectAll(TABLE[table].name)).map(normalize);
    }
    return out;
  }

  async push(rows: Snapshot): Promise<void> {
    for (const table of Object.keys(TABLE) as SnapshotTable[]) {
      const { name, conflict } = TABLE[table];
      for (const chunk of chunks(rows[table] as object[], PUSH_CHUNK)) {
        check(await this.client.from(name).upsert(chunk.map((row) => ({ ...row, user_id: this.userId })), { onConflict: conflict }), `Uploading ${name}`);
      }
    }
  }

  async remove(tombstones: Tombstone[]): Promise<void> {
    const skills = tombstones.filter((t) => t.table === "skills").map((t) => t.id);
    const chats = tombstones.filter((t) => t.table === "chats").map((t) => t.id);
    if (skills.length > 0) check(await this.client.from("skills").delete().in("skill_id", skills), "Deleting skills");
    if (chats.length > 0) {
      check(await this.client.from("chat_messages").delete().in("chat_id", chats), "Deleting chat messages");
      check(await this.client.from("chats").delete().in("id", chats), "Deleting chats");
    }
  }

  async pullSettings(): Promise<RemoteSettings | undefined> {
    const row = check(await this.client.from("settings").select("value, updated_at").maybeSingle<{ value: unknown; updated_at: string }>(), "Reading settings");
    return row ? { value: row.value, updatedAt: iso(row.updated_at) } : undefined;
  }

  async pushSettings(value: unknown): Promise<void> {
    check(await this.client.from("settings").upsert({ user_id: this.userId, value, updated_at: new Date().toISOString() }, { onConflict: "user_id" }), "Uploading settings");
  }

  async heartbeat(device: DeviceRow): Promise<void> {
    check(await this.client.from("devices").upsert({ ...device, user_id: this.userId }, { onConflict: "user_id,id" }), "Updating this PC");
  }

  async pendingCommands(deviceId: string): Promise<PcCommand[]> {
    const rows = check(await this.client.from("pc_commands").select("*").eq("device_id", deviceId).eq("status", "pending").order("created_at"), "Reading web commands");
    return (rows as PcCommand[]).map(normalizeCommand);
  }

  async settleCommand(id: string, status: Exclude<CommandStatus, "pending">, detail: string): Promise<boolean> {
    const rows = check(await this.client.from("pc_commands").update({ status, detail, handled_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").select("id"), "Answering a web command");
    return (rows ?? []).length > 0;
  }

  onCommand(deviceId: string, handler: (command: PcCommand) => void): () => void {
    const channel = this.client
      .channel(`pc-commands-${deviceId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pc_commands", filter: `device_id=eq.${deviceId}` }, (payload) => handler(normalizeCommand(payload.new as PcCommand)))
      .subscribe((status, error) => {
        if (error) console.error(`Web commands channel: ${status}`, error);
      });
    return () => {
      this.client.removeChannel(channel).catch((error: unknown) => console.error("Couldn't close the web commands channel", error));
    };
  }

  private async selectAll(table: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const page = check(await this.client.from(table).select("*").range(from, from + PAGE_SIZE - 1), `Reading ${table}`) as unknown[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }
}
