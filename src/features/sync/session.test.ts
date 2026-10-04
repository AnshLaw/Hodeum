import { describe, expect, it } from "vitest";
import type { SyncStatus } from "../account/types";
import { AccountSyncSession, combineStatus, type PresenceLink, type SyncRunner } from "./session";

const SYNCED: SyncStatus = { state: "idle", lastSyncedAt: "2026-10-03T10:00:00.000Z" };

class FakeEngine implements SyncRunner {
  current: SyncStatus = { state: "idle" };
  syncs = 0;
  running = false;
  private listener: ((status: SyncStatus) => void) | undefined;
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  status() {
    return this.current;
  }
  subscribe(listener: (status: SyncStatus) => void) {
    this.listener = listener;
    return () => (this.listener = undefined);
  }
  async syncNow() {
    this.syncs++;
  }
  emit(status: SyncStatus) {
    this.current = status;
    this.listener?.(status);
  }
}

class FakeLink implements PresenceLink {
  refreshes = 0;
  running = false;
  async start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  async refresh() {
    this.refreshes++;
  }
}

describe("combineStatus", () => {
  it("passes sync through while this PC is visible to the dashboard", () => {
    expect(combineStatus(SYNCED, undefined)).toEqual(SYNCED);
  });

  it("turns an unseen PC into a visible sync error", () => {
    expect(combineStatus(SYNCED, "The web dashboard can't see this PC: offline")).toEqual({ ...SYNCED, state: "error", error: "The web dashboard can't see this PC: offline" });
  });

  it("keeps the sync engine's own failure first, and never hides syncing or a blocked account", () => {
    expect(combineStatus({ state: "error", error: "Uploading skills: boom" }, "presence")).toMatchObject({ state: "error", error: "Uploading skills: boom" });
    expect(combineStatus({ state: "syncing" }, "presence").state).toBe("syncing");
    expect(combineStatus({ state: "blocked", error: "other account" }, "presence").error).toBe("other account");
  });
});

describe("AccountSyncSession", () => {
  function setup() {
    const engine = new FakeEngine();
    const link = new FakeLink();
    let report: (problem?: string) => void = () => {};
    const session = new AccountSyncSession(engine, (onPresence) => {
      report = onPresence;
      return link;
    });
    const seen: SyncStatus[] = [];
    session.subscribe((status) => seen.push(status));
    return { engine, link, session, seen, report: (problem?: string) => report(problem) };
  }

  it("starts and stops sync and the dashboard link together", () => {
    const { engine, link, session } = setup();
    session.start();
    expect(engine.running && link.running).toBe(true);
    session.stop();
    expect(engine.running || link.running).toBe(false);
  });

  it("shows a presence failure, then clears it when the PC is seen again", () => {
    const { engine, session, seen, report } = setup();
    session.start();
    engine.emit(SYNCED);
    report("The web dashboard can't see this PC: offline");
    expect(seen.at(-1)).toMatchObject({ state: "error", error: expect.stringContaining("can't see this PC") });
    expect(session.status().state).toBe("error");
    report(undefined);
    expect(seen.at(-1)).toEqual(SYNCED);
  });

  it("retries both sync and presence on request", async () => {
    const { engine, link, session } = setup();
    session.start();
    await session.retry();
    expect(engine.syncs).toBe(1);
    expect(link.refreshes).toBe(1);
  });
});
