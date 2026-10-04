import type { HodeSummary } from "../../lib/bus";
import type { SkillRecord } from "../../lib/types";
import type { ChatMessage, ChatRole, HodeEventKind, HodeOutcome } from "../../data/types";

/** Rows as Postgres stores them (snake_case); `user_id` is added by the cloud adapter. */
export interface RemoteHode {
  id: string;
  goal: string;
  pack_id: string | null;
  open: boolean;
  started_at: string;
  ended_at: string | null;
  outcome: HodeOutcome | null;
}

export interface RemoteEvent {
  hode_id: string;
  /** Position within its Hode; events are append-only, so this is stable. */
  seq: number;
  kind: HodeEventKind;
  detail: string | null;
  at: string;
}

export interface RemoteChat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface RemoteMessage {
  id: string;
  chat_id: string;
  role: ChatRole;
  content: string;
  context: string | null;
  web: ChatMessage["web"] | null;
  at: string;
}

export interface Snapshot {
  skills: SkillRecord[];
  hodes: RemoteHode[];
  events: RemoteEvent[];
  chats: RemoteChat[];
  messages: RemoteMessage[];
}

export type SnapshotTable = keyof Snapshot;

export const EMPTY_SNAPSHOT: Snapshot = { skills: [], hodes: [], events: [], chats: [], messages: [] };

export interface RemoteSettings {
  value: unknown;
  updatedAt: string;
}

/** A local deletion that must also happen in the cloud (and must not be pulled back). */
export interface Tombstone {
  table: "skills" | "chats";
  id: string;
}

export interface DeviceRow {
  id: string;
  name: string;
  last_seen_at: string;
  live: HodeSummary | null;
}

export const COMMAND_KINDS = ["start_hode", "end_hode"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
export type CommandStatus = "pending" | "started" | "ended" | "rejected" | "expired";

export interface PcCommand {
  id: string;
  device_id: string;
  kind: CommandKind;
  goal: string | null;
  status: CommandStatus;
  detail: string | null;
  created_at: string;
}

/** The learner's account data in the cloud. Implemented over Supabase; faked in tests. */
export interface SyncCloud {
  pull(): Promise<Snapshot>;
  /** Upserts the given rows. */
  push(rows: Snapshot): Promise<void>;
  remove(tombstones: Tombstone[]): Promise<void>;
  pullSettings(): Promise<RemoteSettings | undefined>;
  pushSettings(value: unknown): Promise<void>;
}

/** The PC side of the web dashboard's command channel. */
export interface CommandCloud {
  heartbeat(device: DeviceRow): Promise<void>;
  pendingCommands(deviceId: string): Promise<PcCommand[]>;
  /** Moves a still-pending command to its final status; false if something else already did. */
  settleCommand(id: string, status: Exclude<CommandStatus, "pending">, detail: string): Promise<boolean>;
  /** New commands for this device as they're inserted. Returns an unsubscribe. */
  onCommand(deviceId: string, handler: (command: PcCommand) => void): () => void;
}
