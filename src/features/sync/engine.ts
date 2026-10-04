import type { Bus } from "../../lib/bus";
import { parseSettings, type SettingsStore } from "../../data/settings";
import type { SyncStatus } from "../account/types";
import { PushLedger, isEmptySnapshot, mergeSettings, planPull, same } from "./merge";
import type { SyncState } from "./state";
import type { Snapshot, SyncCloud } from "./types";

/** Waits for a burst of local changes (a Hode logging steps) to settle before syncing. */
export const SYNC_DEBOUNCE_MS = 3_000;
/** Picks up other PCs' changes even when this one is idle. */
export const SYNC_INTERVAL_MS = 5 * 60_000;

export interface LocalSyncSource {
  snapshot(): Promise<Snapshot>;
  write(rows: Snapshot): Promise<void>;
}

export interface SyncEngineDeps {
  cloud: SyncCloud;
  local: LocalSyncSource;
  settings: SettingsStore;
  state: SyncState;
  bus: Bus;
  /** Wraps each pass so the notch's blue cloud dot shows while data leaves the PC. */
  track?: <T>(work: () => Promise<T>) => Promise<T>;
}


const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Keeps the local database and the signed-in account in step: pull, merge locally, push what changed. */
export class SyncEngine {
  passes = 0;
  private current: SyncStatus = { state: "idle" };
  private running: Promise<void> | undefined;
  private again = false;
  private readonly ledger = new PushLedger();
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private stopTriggers: (() => void) | undefined;

  constructor(private readonly deps: SyncEngineDeps) {}

  status(): SyncStatus {
    return this.current;
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Syncs now, then after local changes and on an interval, until `stop`. */
  start(): void {
    if (this.stopTriggers) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void this.syncNow(), SYNC_DEBOUNCE_MS);
    };
    const interval = setInterval(() => void this.syncNow(), SYNC_INTERVAL_MS);
    const offs = [this.deps.bus.on("data:changed", soon), this.deps.bus.on("settings:changed", soon), this.deps.bus.on("sync:deleted", soon)];
    this.stopTriggers = () => {
      clearTimeout(debounce);
      clearInterval(interval);
      offs.forEach((off) => off());
    };
    void this.syncNow();
  }

  stop(): void {
    this.stopTriggers?.();
    this.stopTriggers = undefined;
    this.ledger.reset();
  }

  /** One pass at a time; a request during a pass runs one more afterwards. Never throws. */
  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      this.set({ ...this.current, state: "syncing" });
      try {
        const track = this.deps.track ?? ((work) => work());
        await track(() => this.pass());
        this.set({ state: "idle", lastSyncedAt: new Date().toISOString() });
      } catch (error) {
        console.error("Sync failed; local data is unchanged and it will retry", error);
        this.set({ ...this.current, state: "error", error: errorText(error) });
      }
    } while (this.again);
  }

  private async pass(): Promise<void> {
    this.passes++;
    const { cloud, local, state, bus } = this.deps;
    const tombstones = state.tombstones();
    if (tombstones.length > 0) {
      await cloud.remove(tombstones);
      state.clearTombstones(tombstones);
    }
    const [remote, mine] = await Promise.all([cloud.pull(), local.snapshot()]);
    // What the cloud already has needn't be uploaded again.
    this.ledger.commit(remote);
    const incoming = planPull(mine, remote, state.tombstones());
    const pulled = !isEmptySnapshot(incoming);
    if (pulled) await local.write(incoming);
    const outgoing = this.ledger.changed(pulled ? await local.snapshot() : mine);
    if (!isEmptySnapshot(outgoing)) {
      await cloud.push(outgoing);
      this.ledger.commit(outgoing);
    }
    if (pulled) bus.emit("data:changed", {});
    await this.syncSettings();
  }

  private async syncSettings(): Promise<void> {
    const { cloud, settings, state, bus } = this.deps;
    const defaults = parseSettings({});
    const merge = mergeSettings({ local: await settings.load(), base: state.settingsBase(), remote: (await cloud.pullSettings())?.value, isDefault: (value) => same(value, defaults) });
    if (merge.apply !== undefined) {
      await settings.save(parseSettings(merge.apply));
      bus.emit("settings:changed", {});
    }
    if (merge.push !== undefined) await cloud.pushSettings(merge.push);
    state.setSettingsBase(merge.base);
  }

  private set(status: SyncStatus): void {
    this.current = status;
    for (const listener of [...this.listeners]) listener(status);
  }
}
