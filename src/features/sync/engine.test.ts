import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { DEFAULT_SETTINGS, MemorySettingsStore } from "../../data/settings";
import { SqliteLearningStore } from "../../data/sqlite-stores";
import { testDatabase } from "../../data/test-sql";
import { SyncEngine } from "./engine";
import { FakeCloud } from "./fake-cloud";
import { SqliteSyncSource } from "./local";
import { MemorySyncState, recordDeletions } from "./state";

const AT = "2026-10-03T10:00:00.000Z";
const OUTCOME = { completed: true, mistakes: 0, level: "guide", escalated: false } as const;

function setup() {
  const db = testDatabase();
  const bus = new LocalBus();
  const cloud = new FakeCloud();
  const settings = new MemorySettingsStore();
  const state = new MemorySyncState();
  const engine = new SyncEngine({ cloud, local: new SqliteSyncSource(db), settings, state, bus });
  recordDeletions(bus, state);
  return { db, bus, cloud, settings, state, engine, learning: new SqliteLearningStore(db) };
}

describe("SyncEngine", () => {
  it("uploads local progress and then only what changes", async () => {
    const { cloud, engine, learning } = setup();
    await learning.startHode({ id: "h1", goal: "pivot", open: false, startedAt: AT });
    await engine.syncNow();
    expect(cloud.rows.hodes.map((h) => h.id)).toEqual(["h1"]);

    await learning.endHode("h1", "completed", AT);
    await engine.syncNow();
    expect(cloud.pushes.at(-1)?.hodes).toEqual([expect.objectContaining({ id: "h1", outcome: "completed" })]);
    expect(engine.status()).toMatchObject({ state: "idle", lastSyncedAt: expect.any(String) });
  });

  it("brings down another PC's Hodes and tells the views", async () => {
    const { cloud, bus, engine, learning } = setup();
    cloud.rows.hodes = [{ id: "far", goal: "zip a folder", pack_id: null, open: false, started_at: AT, ended_at: AT, outcome: "completed" }];
    let changed = 0;
    bus.on("data:changed", () => changed++);
    await engine.syncNow();
    expect((await learning.listHodes(10)).map((h) => h.id)).toEqual(["far"]);
    expect(changed).toBe(1);
    expect(cloud.pushes).toEqual([]);
  });

  it("deletes tombstoned rows in the cloud instead of pulling them back", async () => {
    const { cloud, bus, engine, learning, state } = setup();
    await learning.recordOutcome("excel.select_data", OUTCOME);
    await engine.syncNow();
    await learning.resetSkill("excel.select_data");
    bus.emit("sync:deleted", { table: "skills", id: "excel.select_data" });
    expect(state.tombstones()).toHaveLength(1);
    await engine.syncNow();
    expect(cloud.rows.skills).toEqual([]);
    expect(await learning.listSkills()).toEqual([]);
    expect(state.tombstones()).toEqual([]);
  });

  it("gives a fresh PC the account's settings", async () => {
    const { cloud, bus, engine, settings } = setup();
    cloud.settings = { value: { ...DEFAULT_SETTINGS, stuckSeconds: 30 }, updatedAt: AT };
    let told = 0;
    bus.on("settings:changed", () => told++);
    await engine.syncNow();
    expect((await settings.load()).stuckSeconds).toBe(30);
    expect(told).toBe(1);
  });

  it("uploads a local settings change", async () => {
    const { cloud, engine, settings } = setup();
    await engine.syncNow();
    await settings.save({ ...DEFAULT_SETTINGS, stuckSeconds: 20 });
    await engine.syncNow();
    expect(cloud.settings?.value).toMatchObject({ stuckSeconds: 20 });
  });

  it("reports a failed pass without touching local data, and recovers", async () => {
    const { cloud, engine, learning } = setup();
    await learning.startHode({ id: "h1", goal: "pivot", open: false, startedAt: AT });
    cloud.failNext = new Error("network down");
    await engine.syncNow();
    expect(engine.status()).toMatchObject({ state: "error", error: "network down" });
    expect(await learning.listHodes(10)).toHaveLength(1);
    await engine.syncNow();
    expect(engine.status().state).toBe("idle");
    expect(cloud.rows.hodes).toHaveLength(1);
  });

  it("runs one pass at a time and follows up once if asked during it", async () => {
    const { cloud, engine } = setup();
    await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);
    expect(cloud.pushes.length).toBeLessThanOrEqual(1);
    expect(engine.passes).toBe(2);
  });
});
