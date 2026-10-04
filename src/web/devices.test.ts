import { describe, expect, it } from "vitest";
import type { DeviceRow } from "../features/sync/types";
import { isOnline, noPcMessage, pickDevice } from "./devices";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");
const device = (id: string, secondsAgo: number): DeviceRow => ({ id, name: id.toUpperCase(), last_seen_at: new Date(NOW - secondsAgo * 1000).toISOString(), live: null });

describe("devices", () => {
  it("counts a PC as online when it checked in recently", () => {
    expect(isOnline(device("a", 30), NOW)).toBe(true);
    expect(isOnline(device("a", 600), NOW)).toBe(false);
  });

  it("keeps the learner's chosen PC while it's online, else picks the most recently seen", () => {
    const list = [device("old", 900), device("fresh", 10), device("mid", 60)];
    expect(pickDevice(list, "mid", NOW)?.id).toBe("mid");
    expect(pickDevice(list, "gone", NOW)?.id).toBe("fresh");
    expect(pickDevice(list, undefined, NOW)?.id).toBe("fresh");
    expect(pickDevice([], undefined, NOW)).toBeUndefined();
  });

  it("doesn't stick to a chosen PC that went quiet (an old copy of Hodeum on the same PC)", () => {
    expect(pickDevice([device("old", 900), device("fresh", 10)], "old", NOW)?.id).toBe("fresh");
  });

  it("says why there's no PC to start a Hode on, instead of one catch-all", () => {
    expect(noPcMessage({ state: "loading" }, "learner@example.com")).toBe("Still looking for your PCs…");
    expect(noPcMessage({ state: "error", message: "JWT expired" }, "learner@example.com")).toBe("Couldn't load your PCs: JWT expired. Reload the page to try again.");
    const none = noPcMessage({ state: "ready", value: [] }, "learner@example.com");
    expect(none).toContain("learner@example.com");
    expect(none).toContain("Settings › Account");
    expect(none).toContain("sync on");
    expect(noPcMessage({ state: "ready", value: [] }, undefined)).toContain("the same Google account");
  });
});
