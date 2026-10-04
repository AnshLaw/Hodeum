import type { Bus } from "../../lib/bus";
import type { Tombstone } from "./types";

/** What sync remembers on this PC between passes and restarts. */
export interface SyncState {
  tombstones(): Tombstone[];
  addTombstone(tombstone: Tombstone): void;
  clearTombstones(done: Tombstone[]): void;
  /** The settings blob this PC and the account last agreed on. */
  settingsBase(): unknown;
  setSettingsBase(value: unknown): void;
}

const sameTombstone = (a: Tombstone, b: Tombstone) => a.table === b.table && a.id === b.id;
const withTombstone = (list: Tombstone[], tombstone: Tombstone) => (list.some((t) => sameTombstone(t, tombstone)) ? list : [...list, tombstone]);
const withoutTombstones = (list: Tombstone[], done: Tombstone[]) => list.filter((t) => !done.some((d) => sameTombstone(t, d)));

export class MemorySyncState implements SyncState {
  private list: Tombstone[] = [];
  private base: unknown;

  tombstones(): Tombstone[] {
    return [...this.list];
  }

  addTombstone(tombstone: Tombstone): void {
    this.list = withTombstone(this.list, tombstone);
  }

  clearTombstones(done: Tombstone[]): void {
    this.list = withoutTombstones(this.list, done);
  }

  settingsBase(): unknown {
    return this.base;
  }

  setSettingsBase(value: unknown): void {
    this.base = value;
  }
}

const STORAGE_KEY = "hodeum.sync";

interface Saved {
  userId?: string;
  tombstones: Tombstone[];
  base?: unknown;
}

/**
 * Kept in the notch window's localStorage and read fresh on every call, so the signed-out
 * deletion recorder and a signed-in engine can share it. The settings base belongs to one account;
 * deletions made while signed out apply to whoever signs in next.
 */
export class BrowserSyncState implements SyncState {
  constructor(
    private readonly storage: Storage,
    private readonly userId?: string,
  ) {}

  tombstones(): Tombstone[] {
    return this.read().tombstones;
  }

  addTombstone(tombstone: Tombstone): void {
    const saved = this.read();
    this.write({ ...saved, tombstones: withTombstone(saved.tombstones, tombstone) });
  }

  clearTombstones(done: Tombstone[]): void {
    const saved = this.read();
    this.write({ ...saved, tombstones: withoutTombstones(saved.tombstones, done) });
  }

  settingsBase(): unknown {
    const saved = this.read();
    return saved.userId === this.userId ? saved.base : undefined;
  }

  setSettingsBase(value: unknown): void {
    this.write({ ...this.read(), userId: this.userId, base: value });
  }

  private read(): Saved {
    try {
      const saved = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
      return { ...saved, tombstones: Array.isArray(saved?.tombstones) ? saved.tombstones : [] };
    } catch (error) {
      console.error("Sync's saved state is unreadable; starting fresh", error);
      return { tombstones: [] };
    }
  }

  private write(saved: Saved): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      console.error("Couldn't save sync state", error);
    }
  }
}

/** Records local deletions for the next pass. Runs whether or not anyone is signed in. */
export function recordDeletions(bus: Bus, state: Pick<SyncState, "addTombstone">): () => void {
  return bus.on("sync:deleted", (tombstone) => state.addTombstone(tombstone));
}
