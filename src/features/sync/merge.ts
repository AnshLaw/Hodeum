import type { Snapshot, SnapshotTable, Tombstone } from "./types";

/** The identity of a row in its table, matching the Postgres primary key (minus `user_id`). */
const ROW_KEY: { [T in SnapshotTable]: (row: Snapshot[T][number]) => string } = {
  skills: (row) => row.skill_id,
  hodes: (row) => row.id,
  events: (row) => `${row.hode_id}#${row.seq}`,
  chats: (row) => row.id,
  messages: (row) => row.id,
};

const TABLES = Object.keys(ROW_KEY) as SnapshotTable[];

function keysOf<T extends SnapshotTable>(table: T, rows: Snapshot[T]): Set<string> {
  const key = ROW_KEY[table] as (row: Snapshot[T][number]) => string;
  return new Set(rows.map(key));
}

/**
 * What to write locally from the cloud. Skills: newer `last_seen_at` wins, ties keep local.
 * Everything else is append-only, so only missing rows come down. Tombstoned rows never do.
 */
export function planPull(local: Snapshot, remote: Snapshot, tombstones: Tombstone[]): Snapshot {
  const deletedSkills = new Set(tombstones.filter((t) => t.table === "skills").map((t) => t.id));
  const deletedChats = new Set(tombstones.filter((t) => t.table === "chats").map((t) => t.id));
  const localSkills = new Map(local.skills.map((s) => [s.skill_id, s]));
  const has = { hodes: keysOf("hodes", local.hodes), events: keysOf("events", local.events), chats: keysOf("chats", local.chats), messages: keysOf("messages", local.messages) };
  return {
    skills: remote.skills.filter((s) => {
      if (deletedSkills.has(s.skill_id)) return false;
      const mine = localSkills.get(s.skill_id);
      return !mine || s.last_seen_at > mine.last_seen_at;
    }),
    hodes: remote.hodes.filter((h) => !has.hodes.has(ROW_KEY.hodes(h))),
    events: remote.events.filter((e) => !has.events.has(ROW_KEY.events(e))),
    chats: remote.chats.filter((c) => !deletedChats.has(c.id) && !has.chats.has(c.id)),
    messages: remote.messages.filter((m) => !deletedChats.has(m.chat_id) && !has.messages.has(m.id)),
  };
}

export interface SettingsMerge {
  /** Write this to local settings. */
  apply?: unknown;
  /** Upload this as the account's settings. */
  push?: unknown;
  /** The blob both sides agree on afterwards. */
  base: unknown;
}

/** JSON with object keys sorted, so rows compare equal whichever database produced them. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

export const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);

/** Three-way merge of the settings blob against the last one this PC synced. */
export function mergeSettings(input: { local: unknown; base: unknown; remote: unknown; isDefault: (value: unknown) => boolean }): SettingsMerge {
  const { local, base, remote, isDefault } = input;
  if (remote === undefined) return { push: local, base: local };
  if (same(local, remote)) return { base: local };
  const localEdited = base === undefined ? !isDefault(local) : !same(local, base);
  return localEdited ? { push: local, base: local } : { apply: remote, base: remote };
}

/** Remembers what was pushed this session so each pass only uploads rows that changed. */
export class PushLedger {
  private readonly pushed = new Map<string, string>();

  changed(snapshot: Snapshot): Snapshot {
    const out = {} as Snapshot;
    for (const table of TABLES) {
      const key = ROW_KEY[table] as (row: unknown) => string;
      (out[table] as unknown[]) = (snapshot[table] as unknown[]).filter((row) => this.pushed.get(`${table}:${key(row)}`) !== stableJson(row));
    }
    return out;
  }

  commit(rows: Snapshot): void {
    for (const table of TABLES) {
      const key = ROW_KEY[table] as (row: unknown) => string;
      for (const row of rows[table] as unknown[]) this.pushed.set(`${table}:${key(row)}`, stableJson(row));
    }
  }

  reset(): void {
    this.pushed.clear();
  }
}

export const isEmptySnapshot = (snapshot: Snapshot): boolean => TABLES.every((table) => snapshot[table].length === 0);
