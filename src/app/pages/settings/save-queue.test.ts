import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "../../../data/settings";
import { SaveQueue } from "./save-queue";

/** First write is slow, later ones fast: without ordering, the stale write would land last. */
class SlowFirstStore implements SettingsStore {
  saved: Settings = DEFAULT_SETTINGS;
  private writes = 0;
  async load() {
    return this.saved;
  }
  async save(settings: Settings) {
    const delay = this.writes++ === 0 ? 20 : 0;
    await new Promise((resolve) => setTimeout(resolve, delay));
    this.saved = settings;
  }
}

describe("SaveQueue", () => {
  it("writes quick successive changes in order, so the latest one wins", async () => {
    const store = new SlowFirstStore();
    const queue = new SaveQueue(store, () => undefined, () => undefined);
    queue.save({ ...DEFAULT_SETTINGS, stuckSeconds: 20 });
    await queue.save({ ...DEFAULT_SETTINGS, stuckSeconds: 30 });
    expect(store.saved.stuckSeconds).toBe(30);
  });

  it("reports a failed write and keeps going", async () => {
    const errors: unknown[] = [];
    const failing: SettingsStore = { load: async () => DEFAULT_SETTINGS, save: async () => Promise.reject(new Error("disk full")) };
    const queue = new SaveQueue(failing, () => undefined, (e) => errors.push(e));
    await queue.save(DEFAULT_SETTINGS);
    await queue.save(DEFAULT_SETTINGS);
    expect(errors).toHaveLength(2);
  });
});
