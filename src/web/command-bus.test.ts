import { afterEach, describe, expect, it, vi } from "vitest";
import type { HodeSummary } from "../lib/bus";
import type { CommandKind, DeviceRow, PcCommand } from "../features/sync/types";
import { HEARTBEAT_MS } from "../features/sync/device-link";
import { ANSWER_TIMEOUT_MS, WebBus, liveOn, type CommandFeedback, type CommandSender } from "./command-bus";

const NOW = Date.parse("2026-10-03T10:00:00.000Z");
const PC: DeviceRow = { id: "pc-1", name: "ANSH-PC", last_seen_at: new Date(NOW).toISOString(), live: null };

class FakeSender implements CommandSender {
  sent: { deviceId: string; kind: CommandKind; goal?: string }[] = [];
  answer: PcCommand["status"] = "started";
  async send(deviceId: string, kind: CommandKind, goal?: string): Promise<string> {
    this.sent.push({ deviceId, kind, goal });
    return `cmd-${this.sent.length}`;
  }
  async status(): Promise<Pick<PcCommand, "status" | "detail">> {
    return { status: this.answer, detail: this.answer === "rejected" ? "A Hode needs a goal" : null };
  }
}

function setup(target: DeviceRow | null = PC) {
  vi.useFakeTimers({ now: NOW });
  const sender = new FakeSender();
  const feedback: CommandFeedback[] = [];
  const bus = new WebBus(sender, () => target ?? undefined, (f) => feedback.push(f), () => "No PC is linked to learner@example.com yet.");
  return { sender, feedback, bus };
}

describe("WebBus", () => {
  afterEach(() => vi.useRealTimers());

  it("turns Start a Hode into a command for the chosen PC and reports when it starts", async () => {
    const { bus, sender, feedback } = setup();
    bus.emit("hode:start", { goal: "make a pivot table" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sender.sent).toEqual([{ deviceId: "pc-1", kind: "start_hode", goal: "make a pivot table" }]);
    expect(feedback.map((f) => f.tone)).toEqual(["pending", "done"]);
    expect(feedback.at(-1)?.text).toContain("ANSH-PC");
  });

  it("shows the PC's reason when it refuses", async () => {
    const { bus, sender, feedback } = setup();
    sender.answer = "rejected";
    bus.emit("hode:start", { goal: "x" });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(feedback.at(-1)).toMatchObject({ tone: "error", text: expect.stringContaining("A Hode needs a goal") });
  });

  it("says when the PC never answers", async () => {
    const { bus, sender, feedback } = setup();
    sender.answer = "pending";
    bus.emit("hode:end", {});
    await vi.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS + 3_000);
    expect(sender.sent[0].kind).toBe("end_hode");
    expect(feedback.at(-1)).toMatchObject({ tone: "error", text: expect.stringContaining("didn't answer") });
  });

  it("asks for a PC when none is signed in", async () => {
    const { bus, sender, feedback } = setup(null);
    bus.emit("hode:start", { goal: "pivot" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sender.sent).toEqual([]);
    expect(feedback.at(-1)).toEqual({ tone: "error", text: "No PC is linked to learner@example.com yet." });
  });

  it("waits longer than the PC's fallback check before saying it never answered", () => {
    expect(ANSWER_TIMEOUT_MS).toBeGreaterThan(HEARTBEAT_MS);
  });

  it("answers summary requests with the chosen PC's live Hode", () => {
    const live: HodeSummary = { phase: "guiding", goal: "pivot", title: "Select your data" };
    const { bus } = setup({ ...PC, live });
    const seen: HodeSummary[] = [];
    bus.on("hode:summary", (s) => seen.push(s));
    bus.emit("hode:summary-request", {});
    expect(seen).toEqual([live]);
  });

  it("doesn't show the last Hode of a PC that went offline as still running", () => {
    const live: HodeSummary = { phase: "guiding", goal: "pivot", title: "Select your data" };
    const quiet = { ...PC, live, last_seen_at: new Date(Date.now() - 3_600_000).toISOString() };
    expect(liveOn(quiet).phase).toBe("idle");
    expect(liveOn({ ...PC, live, last_seen_at: new Date().toISOString() })).toEqual(live);
  });
});
