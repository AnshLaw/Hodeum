import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSettings, type Settings, type SettingsStore } from "../data/settings";
import type { HodeDetail, HodeEventKind, HodeOutcome, HodeRecord, LearningStore } from "../data/types";
import type { AssistanceLevel, SkillRecord } from "../lib/types";
import type { CommandKind, DeviceRow, PcCommand } from "../features/sync/types";
import type { CommandSender } from "./command-bus";

const PC_ONLY = "Hodes are recorded on your PC, not in the web dashboard.";

interface HodeRow {
  id: string;
  goal: string;
  pack_id: string | null;
  open: boolean;
  started_at: string;
  ended_at: string | null;
  outcome: HodeOutcome | null;
}

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

function hodeFromRow(row: HodeRow): HodeRecord {
  return { id: row.id, goal: row.goal, ...(row.pack_id ? { packId: row.pack_id } : {}), open: row.open, startedAt: row.started_at, ...(row.ended_at ? { endedAt: row.ended_at } : {}), ...(row.outcome ? { outcome: row.outcome } : {}) };
}

/** The synced learning history, read from the account. Skill edits flow back to the PC on its next sync. */
export class SupabaseLearningStore implements LearningStore {
  constructor(private readonly client: SupabaseClient) {}

  async listHodes(limit: number): Promise<HodeRecord[]> {
    return (check(await this.client.from("hodes").select("*").order("started_at", { ascending: false }).limit(limit)) as HodeRow[]).map(hodeFromRow);
  }

  async getHode(id: string): Promise<HodeDetail | null> {
    const row = check(await this.client.from("hodes").select("*").eq("id", id).maybeSingle<HodeRow>());
    if (!row) return null;
    const events = check(await this.client.from("hode_events").select("kind, detail, at").eq("hode_id", id).order("seq")) as { kind: HodeEventKind; detail: string | null; at: string }[];
    return { ...hodeFromRow(row), events: events.map((e) => ({ hodeId: id, kind: e.kind, ...(e.detail ? { detail: e.detail } : {}), at: e.at })) };
  }

  async listSkills(): Promise<SkillRecord[]> {
    return check(await this.client.from("skills").select("skill_id, status, confidence, success_count, failure_count, last_assistance_level, last_seen_at").order("skill_id")) as SkillRecord[];
  }

  /** Bumps `last_seen_at` so the PC treats this as the newer copy. */
  async setSkillLevel(skillId: string, level: AssistanceLevel): Promise<void> {
    const status = level === "independent" ? "mastered" : "learning";
    const rows = check(await this.client.from("skills").update({ last_assistance_level: level, status, last_seen_at: new Date().toISOString() }).eq("skill_id", skillId).select("skill_id"));
    if ((rows ?? []).length === 0) throw new Error(`Unknown skill: ${skillId}`);
  }

  /** A fresh, newer record rather than a delete, so the PC's next sync resets it instead of re-uploading it. */
  async resetSkill(skillId: string): Promise<void> {
    check(await this.client.from("skills").update({ status: "new", confidence: 0, success_count: 0, failure_count: 0, last_assistance_level: "demonstrate", last_seen_at: new Date().toISOString() }).eq("skill_id", skillId));
  }

  startHode(): Promise<void> {
    return Promise.reject(new Error(PC_ONLY));
  }

  logEvent(): Promise<void> {
    return Promise.reject(new Error(PC_ONLY));
  }

  endHode(): Promise<void> {
    return Promise.reject(new Error(PC_ONLY));
  }

  closeOpenHodes(): Promise<number> {
    return Promise.reject(new Error(PC_ONLY));
  }
}

/** The account's synced settings, so the dashboard wears the learner's theme and accent. Read-only. */
export class SupabaseSettingsStore implements SettingsStore {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<Settings> {
    const row = check(await this.client.from("settings").select("value").maybeSingle<{ value: unknown }>());
    return parseSettings(row?.value);
  }

  save(): Promise<void> {
    return Promise.reject(new Error("Change settings in the Hodeum app on your PC."));
  }
}

export class SupabaseCommandSender implements CommandSender {
  constructor(private readonly client: SupabaseClient) {}

  async send(deviceId: string, kind: CommandKind, goal?: string): Promise<string> {
    const row = check(await this.client.from("pc_commands").insert({ device_id: deviceId, kind, goal: goal ?? null }).select("id").single<{ id: string }>());
    if (!row) throw new Error("The command wasn't saved.");
    return row.id;
  }

  async status(id: string): Promise<Pick<PcCommand, "status" | "detail">> {
    const row = check(await this.client.from("pc_commands").select("status, detail").eq("id", id).single<Pick<PcCommand, "status" | "detail">>());
    if (!row) throw new Error("The command disappeared.");
    return row;
  }
}

export async function listDevices(client: SupabaseClient): Promise<DeviceRow[]> {
  return check(await client.from("devices").select("id, name, last_seen_at, live").order("last_seen_at", { ascending: false })) as DeviceRow[];
}

/** Calls back when the learner's PCs or progress change (Realtime). Returns an unsubscribe. */
export function watchAccount(client: SupabaseClient, on: { devices: () => void; progress: () => void }): () => void {
  const channel = client
    .channel("dashboard")
    .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, on.devices)
    .on("postgres_changes", { event: "*", schema: "public", table: "hodes" }, on.progress)
    .on("postgres_changes", { event: "*", schema: "public", table: "skills" }, on.progress)
    .subscribe((status, error) => {
      if (error) console.error(`Dashboard live updates: ${status}`, error);
    });
  return () => {
    client.removeChannel(channel).catch((error: unknown) => console.error("Couldn't close live updates", error));
  };
}
