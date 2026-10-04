import { EMPTY_SNAPSHOT, type CommandCloud, type DeviceRow, type PcCommand, type RemoteSettings, type Snapshot, type SnapshotTable, type SyncCloud, type Tombstone } from "./types";

const KEY: Record<SnapshotTable, (row: never) => string> = {
  skills: (row: { skill_id: string }) => row.skill_id,
  hodes: (row: { id: string }) => row.id,
  events: (row: { hode_id: string; seq: number }) => `${row.hode_id}#${row.seq}`,
  chats: (row: { id: string }) => row.id,
  messages: (row: { id: string }) => row.id,
};

/** An in-memory account for tests: one learner's rows, devices and commands. */
export class FakeCloud implements SyncCloud, CommandCloud {
  rows: Snapshot = structuredClone(EMPTY_SNAPSHOT);
  settings: RemoteSettings | undefined;
  devices = new Map<string, DeviceRow>();
  commands: PcCommand[] = [];
  pushes: Snapshot[] = [];
  failNext: Error | undefined;
  private readonly listeners = new Set<(command: PcCommand) => void>();

  private check(): void {
    const error = this.failNext;
    this.failNext = undefined;
    if (error) throw error;
  }

  async pull(): Promise<Snapshot> {
    this.check();
    return structuredClone(this.rows);
  }

  async push(rows: Snapshot): Promise<void> {
    this.check();
    this.pushes.push(structuredClone(rows));
    for (const table of Object.keys(KEY) as SnapshotTable[]) {
      const key = KEY[table] as (row: unknown) => string;
      const byKey = new Map((this.rows[table] as unknown[]).map((row) => [key(row), row]));
      for (const row of rows[table] as unknown[]) byKey.set(key(row), structuredClone(row));
      (this.rows[table] as unknown[]) = [...byKey.values()];
    }
  }

  async remove(tombstones: Tombstone[]): Promise<void> {
    this.check();
    for (const { table, id } of tombstones) {
      if (table === "skills") this.rows.skills = this.rows.skills.filter((s) => s.skill_id !== id);
      else {
        this.rows.chats = this.rows.chats.filter((c) => c.id !== id);
        this.rows.messages = this.rows.messages.filter((m) => m.chat_id !== id);
      }
    }
  }

  async pullSettings(): Promise<RemoteSettings | undefined> {
    this.check();
    return structuredClone(this.settings);
  }

  async pushSettings(value: unknown): Promise<void> {
    this.check();
    this.settings = { value: structuredClone(value), updatedAt: new Date().toISOString() };
  }

  async heartbeat(device: DeviceRow): Promise<void> {
    this.check();
    this.devices.set(device.id, structuredClone(device));
  }

  async pendingCommands(deviceId: string): Promise<PcCommand[]> {
    this.check();
    return this.commands.filter((c) => c.device_id === deviceId && c.status === "pending").map((c) => ({ ...c }));
  }

  async settleCommand(id: string, status: Exclude<PcCommand["status"], "pending">, detail: string): Promise<boolean> {
    this.check();
    const command = this.commands.find((c) => c.id === id);
    if (!command || command.status !== "pending") return false;
    Object.assign(command, { status, detail });
    return true;
  }

  onCommand(deviceId: string, handler: (command: PcCommand) => void): () => void {
    const listener = (command: PcCommand) => command.device_id === deviceId && handler({ ...command });
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** What the web dashboard does: insert a command, which Realtime delivers. */
  send(command: Omit<PcCommand, "status" | "detail">): void {
    const row: PcCommand = { ...command, status: "pending", detail: null };
    this.commands.push(row);
    for (const listener of this.listeners) listener(row);
  }
}
