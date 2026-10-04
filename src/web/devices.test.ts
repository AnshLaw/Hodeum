import { describe, expect, it } from "vitest";
import type { DeviceRow } from "../features/sync/types";
import { isOnline, pickDevice } from "./devices";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");
const device = (id: string, secondsAgo: number): DeviceRow => ({ id, name: id.toUpperCase(), last_seen_at: new Date(NOW - secondsAgo * 1000).toISOString(), live: null });

describe("devices", () => {
  it("counts a PC as online when it checked in recently", () => {
    expect(isOnline(device("a", 30), NOW)).toBe(true);
    expect(isOnline(device("a", 600), NOW)).toBe(false);
  });

  it("keeps the learner's chosen PC, else picks the most recently seen", () => {
    const list = [device("old", 900), device("fresh", 10), device("mid", 60)];
    expect(pickDevice(list, "mid")?.id).toBe("mid");
    expect(pickDevice(list, "gone")?.id).toBe("fresh");
    expect(pickDevice(list, undefined)?.id).toBe("fresh");
    expect(pickDevice([], undefined)).toBeUndefined();
  });
});
