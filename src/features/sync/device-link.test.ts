import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus, type BusEvents } from "../../lib/bus";
import { COMMAND_TTL_MS, DeviceLink, MAX_GOAL_LENGTH, judgeCommand } from "./device-link";
import { FakeCloud } from "./fake-cloud";
import type { PcCommand } from "./types";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");
const DEVICE = { id: "pc-1", name: "ANSH-PC" };

const command = (part: Partial<PcCommand>): PcCommand => ({ id: "c1", device_id: DEVICE.id, kind: "start_hode", goal: "make a pivot table", status: "pending", detail: null, created_at: new Date(NOW).toISOString(), ...part });

describe("judgeCommand", () => {
  it("starts a fresh, well-formed Hode", () => {
    expect(judgeCommand(command({ goal: "  make a pivot table " }), DEVICE.id, NOW)).toMatchObject({ status: "started", goal: "make a pivot table" });
  });

  it("rejects commands for another PC, stale ones, empty or over-long goals", () => {
    expect(judgeCommand(command({ device_id: "pc-2" }), DEVICE.id, NOW).status).toBe("rejected");
    expect(judgeCommand(command({ created_at: new Date(NOW - COMMAND_TTL_MS - 1).toISOString() }), DEVICE.id, NOW).status).toBe("expired");
    expect(judgeCommand(command({ goal: "   " }), DEVICE.id, NOW).status).toBe("rejected");
    expect(judgeCommand(command({ goal: "x".repeat(MAX_GOAL_LENGTH + 1) }), DEVICE.id, NOW).status).toBe("rejected");
  });

  it("ends the running Hode", () => {
    expect(judgeCommand(command({ kind: "end_hode", goal: null }), DEVICE.id, NOW).status).toBe("ended");
  });
});

describe("DeviceLink", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers({ now: NOW });
    const bus = new LocalBus();
    const cloud = new FakeCloud();
    const link = new DeviceLink({ cloud, bus, device: DEVICE });
    const started: string[] = [];
    bus.on("hode:start", ({ goal }) => started.push(goal));
    return { bus, cloud, link, started };
  }

  it("announces the PC and starts a Hode sent from the web, once", async () => {
    const { cloud, link, started } = setup();
    await link.start();
    expect(cloud.devices.get(DEVICE.id)).toMatchObject({ name: "ANSH-PC", live: null });
    cloud.send({ id: "c1", device_id: DEVICE.id, kind: "start_hode", goal: "make a pivot table", created_at: new Date(NOW).toISOString() });
    await vi.waitFor(() => expect(started).toEqual(["make a pivot table"]));
    await link.checkPending();
    expect(started).toHaveLength(1);
    expect(cloud.commands[0].status).toBe("started");
    link.stop();
  });

  it("picks up commands sent while it was offline", async () => {
    const { cloud, link, started } = setup();
    cloud.commands.push(command({ id: "c7", goal: "zip a folder" }));
    await link.start();
    expect(started).toEqual(["zip a folder"]);
    link.stop();
  });

  it("marks a Hode it starts as sent from the web, so it can't open apps on this PC", async () => {
    const { bus, cloud, link } = setup();
    const payloads: BusEvents["hode:start"][] = [];
    bus.on("hode:start", (payload) => payloads.push(payload));
    cloud.commands.push(command({ id: "c8", goal: "open command prompt" }));
    await link.start();
    expect(payloads).toEqual([{ goal: "open command prompt", source: "web" }]);
    link.stop();
  });

  it("does not act on a stale command", async () => {
    const { cloud, link, started } = setup();
    cloud.commands.push(command({ created_at: new Date(NOW - COMMAND_TTL_MS * 2).toISOString() }));
    await link.start();
    expect(started).toEqual([]);
    expect(cloud.commands[0].status).toBe("expired");
    link.stop();
  });

  it("shares the live Hode with the dashboard", async () => {
    const { bus, cloud, link } = setup();
    await link.start();
    bus.emit("hode:summary", { phase: "guiding", goal: "pivot", title: "Select your data", step: { current: 1, total: 4 } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloud.devices.get(DEVICE.id)?.live).toMatchObject({ goal: "pivot", step: { current: 1, total: 4 } });
    bus.emit("hode:summary", { phase: "idle", goal: "", title: "" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloud.devices.get(DEVICE.id)?.live).toBeNull();
    link.stop();
  });
});

describe("DeviceLink presence", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers({ now: NOW });
    const cloud = new FakeCloud();
    const problems: (string | undefined)[] = [];
    const link = new DeviceLink({ cloud, bus: new LocalBus(), device: DEVICE, onPresence: (problem) => problems.push(problem) });
    return { cloud, link, problems };
  }

  it("reports when the dashboard can't be told this PC is online, instead of only logging it", async () => {
    const { cloud, link, problems } = setup();
    cloud.failNext = new Error("permission denied for table devices");
    await link.start();
    expect(cloud.devices.size).toBe(0);
    expect(problems.at(-1)).toContain("permission denied for table devices");
    link.stop();
  });

  it("clears the problem once a retry gets through", async () => {
    const { cloud, link, problems } = setup();
    cloud.failNext = new Error("Failed to fetch");
    await link.start();
    await link.refresh();
    expect(cloud.devices.get(DEVICE.id)).toMatchObject({ name: "ANSH-PC" });
    expect(problems.at(-1)).toBeUndefined();
    link.stop();
  });
});
