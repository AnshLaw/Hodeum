import { describe, expect, it } from "vitest";
import { railNote, syncDetail } from "./copy";
import { SIGNED_OUT, type AccountStatus } from "./types";

const NOW = new Date("2026-10-03T10:05:00.000Z");
const signedIn = (patch: Partial<AccountStatus>): AccountStatus => ({ ...SIGNED_OUT, phase: "signed-in", user: { id: "u1", email: "learner@example.com" }, sync: { state: "idle", lastSyncedAt: "2026-10-03T10:00:00.000Z" }, ...patch });

describe("account copy", () => {
  it("says everything stays local until someone signs in", () => {
    expect(railNote(undefined)).toBe("Everything stays on this PC");
    expect(railNote(SIGNED_OUT)).toBe("Everything stays on this PC");
  });

  it("names the account while syncing, and says when it's paused", () => {
    expect(railNote(signedIn({}))).toBe("Syncing to learner@example.com");
    expect(railNote(signedIn({ paused: true }))).toBe("Sync paused · on this PC only");
  });

  it("describes the last sync, a failure, or a pause", () => {
    expect(syncDetail(signedIn({}), NOW)).toMatch(/^Synced /);
    expect(syncDetail(signedIn({ sync: { state: "syncing" } }), NOW)).toBe("Syncing…");
    expect(syncDetail(signedIn({ sync: { state: "error", error: "Failed to fetch" } }), NOW)).toBe("Last sync failed: Failed to fetch. Everything is still on this PC; Hodeum will retry.");
    expect(syncDetail(signedIn({ paused: true, sync: { state: "off" } }), NOW)).toBe("Paused on this PC. Nothing leaves it until you turn sync back on.");
  });
});
