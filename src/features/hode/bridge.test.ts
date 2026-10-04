import { describe, expect, it, vi } from "vitest";
import { LocalBus, type HodeSummary } from "../../lib/bus";
import { MemoryLearningStore } from "../../data/memory-stores";
import { DEFAULT_SETTINGS, MemorySettingsStore } from "../../data/settings";
import { LocalMemoryProvider } from "../../providers/memory/sqlite-memory";
import type { MemoryProvider } from "../../providers/interfaces";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../test-support/scenes/excel";
import { TASK_PACKS } from "../../task-packs";
import type { InstalledApp } from "../../lib/types";
import catalog from "../apps/__fixtures__/start-apps.json";
import { connectHodeBridge, goalEvents, summaryOf } from "./bridge";
import { initialState } from "./model";
import { HodeRuntime } from "./runtime";
import { PACK, guideAction } from "./test-fixtures";

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

const APPS = catalog as InstalledApp[];

function setup(memory?: MemoryProvider, apps: InstalledApp[] = []) {
  const bus = new LocalBus();
  const store = new MemoryLearningStore();
  const settings = new MemorySettingsStore();
  const scene = new ExcelScene();
  const runtime = new HodeRuntime({
    perception: new MockPerception(() => scene),
    reasoners: [new TaskPackReasoningProvider()],
    skills: store,
    bus,
    tts: { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true },
  });
  const applyVoice = vi.fn();
  const applyWebSearch = vi.fn();
  connectHodeBridge({ runtime, bus, log: store, settings, packs: TASK_PACKS, openGoalsAllowed: () => false, applyVoice, applyWebSearch, memory, apps: () => apps });
  return { bus, store, settings, runtime, applyVoice, applyWebSearch };
}

describe("summaryOf", () => {
  it("describes the live Hode for the app", () => {
    expect(summaryOf({ ...initialState, phase: "guiding", goal: "pivot", pack: PACK, action: guideAction() })).toEqual({
      phase: "guiding",
      goal: "pivot",
      title: "Click Insert. I highlighted it.",
      step: { current: 1, total: 2 },
    });
  });
});

describe("connectHodeBridge", () => {
  it("starts a Hode the app asks for, logs it, and broadcasts its status", async () => {
    const { bus, store, runtime } = setup();
    const summaries: HodeSummary[] = [];
    bus.on("hode:summary", (s) => summaries.push(s));
    bus.emit("hode:start", { goal: "make a pivot table" });
    await settle();
    expect(runtime.getState()).toMatchObject({ phase: "guiding", goal: "make a pivot table" });
    expect(summaries.at(-1)).toMatchObject({ phase: "guiding", step: { current: 1, total: 5 } });
    expect((await store.listHodes(5))[0]).toMatchObject({ goal: "make a pivot table", packId: "excel-pivot" });
    bus.emit("hode:end", {});
    await settle();
    expect((await store.listHodes(5))[0].outcome).toBe("ended");
  });

  it("applies saved settings to the runtime and voice", async () => {
    const { bus, settings, applyVoice } = setup();
    await settings.save({ ...DEFAULT_SETTINGS, voice: { enabled: false, rate: 1.3, name: "zira", conversation: true, handsFree: false, language: "en", hindiScript: "devanagari", hindiVoice: "kokoro:31", wakeWords: [], inputDevice: "", outputDevice: "", asrModel: "" }, mode: "help", stuckSeconds: 20 });
    bus.emit("settings:changed", {});
    await settle();
    expect(applyVoice).toHaveBeenLastCalledWith({ enabled: false, rate: 1.3, name: "zira", conversation: true, handsFree: false, language: "en", hindiScript: "devanagari", hindiVoice: "kokoro:31", wakeWords: [], inputDevice: "", outputDevice: "", asrModel: "" });
  });

  it("tells the notch when the learner turns web search on", async () => {
    const { bus, settings, applyWebSearch } = setup();
    await settle();
    expect(applyWebSearch).toHaveBeenLastCalledWith(false);
    await settings.save({ ...DEFAULT_SETTINGS, webSearch: true });
    bus.emit("settings:changed", {});
    await settle();
    expect(applyWebSearch).toHaveBeenLastCalledWith(true);
  });

  it("stores a learning summary when a Hode ends", async () => {
    const memory = new LocalMemoryProvider();
    const { bus } = setup(memory);
    bus.emit("hode:start", { goal: "make a pivot table" });
    await settle();
    bus.emit("hode:end", {});
    await settle();
    const recalled = await memory.getRelevantMemory({ goal: "Make a PivotTable", skillIds: [] });
    expect(recalled).toEqual([expect.objectContaining({ skillId: "excel.navigation.insert_tab" })]);
  });
});

describe("goalEvents", () => {
  const options = { packs: TASK_PACKS, openAllowed: true, apps: APPS };

  it("opens an app the goal asks for", () => {
    expect(goalEvents("open WhatsApp", { ...options, mode: "agent" })).toMatchObject([{ type: "OPEN_APP", app: { name: "WhatsApp" }, mode: "agent" }]);
  });

  it("takes a pack's words or a task as the goal, with the picked mode", () => {
    expect(goalEvents("pivot table", { ...options, mode: "help" })).toMatchObject([{ type: "GOAL_SUBMITTED", pack: { id: "excel-pivot" }, mode: "help" }]);
    expect(goalEvents("send a pdf on whatsapp", options)).toMatchObject([{ type: "GOAL_SUBMITTED", goal: "send a pdf on whatsapp", openAllowed: true }]);
  });

  it("names the installed app a goal is about, as the app to wait for", () => {
    expect(goalEvents("How do I send a message on Discord", options)).toMatchObject([{ type: "GOAL_SUBMITTED", goal: "How do I send a message on Discord", app: "Discord" }]);
    expect(goalEvents("how do I make a playlist in spotify", options)).toMatchObject([{ type: "GOAL_SUBMITTED", app: "Spotify" }]);
    expect(goalEvents("make a chart in excel", options)).toMatchObject([{ type: "GOAL_SUBMITTED", app: "Excel" }]);
  });

  it("names only the built-in apps without a catalog", () => {
    const [event] = goalEvents("How do I send a message on Discord", { ...options, apps: [] });
    expect(event).toMatchObject({ type: "GOAL_SUBMITTED" });
    expect(event).not.toHaveProperty("app", expect.anything());
  });

  it("doesn't teach another app's lesson for a goal about an installed app", () => {
    const [event] = goalEvents("how do I turn on dark mode in Discord", options);
    expect(event).toMatchObject({ type: "GOAL_SUBMITTED", app: "Discord" });
    expect(event).toHaveProperty("pack", undefined);
    expect(goalEvents("how do I turn on dark mode in Settings", options)).toMatchObject([{ type: "GOAL_SUBMITTED", pack: { id: "windows-dark-mode" }, app: "Settings" }]);
    expect(goalEvents("how do I turn on dark mode", options)).toMatchObject([{ type: "GOAL_SUBMITTED", pack: { id: "windows-dark-mode" } }]);
  });

  it("replies instead of starting an open Hode for small talk, noise or something unclear", () => {
    expect(goalEvents("hello there", options)).toEqual([{ type: "CHITCHAT", kind: "greeting" }]);
    expect(goalEvents("hello hello hello", options)).toEqual([{ type: "CHITCHAT", kind: "unclear" }]);
    expect(goalEvents("new tab", options)).toEqual([{ type: "CHITCHAT", kind: "unclear" }]);
  });
});

describe("hode:start", () => {
  it("takes the mode and agent style the sender picked", async () => {
    const { bus, runtime } = setup();
    bus.emit("hode:start", { goal: "make a pivot table", mode: "agent", agentStyle: "execute" });
    await settle();
    expect(runtime.getState()).toMatchObject({ mode: "agent", agentStyle: "execute", goal: "make a pivot table" });
  });

  it("names the installed app the app window's goal is about", async () => {
    const { bus, runtime } = setup(undefined, APPS);
    const dispatch = vi.spyOn(runtime, "dispatch");
    bus.emit("hode:start", { goal: "How do I send a message on Discord" });
    await settle();
    expect(dispatch.mock.calls.map(([event]) => event)).toContainEqual(expect.objectContaining({ type: "GOAL_SUBMITTED", app: "Discord" }));
  });

  it("opens an app instead of starting a Hode, leaving the running one alone", async () => {
    const { bus, runtime } = setup(undefined, APPS);
    bus.emit("hode:start", { goal: "make a pivot table" });
    await settle();
    const dispatch = vi.spyOn(runtime, "dispatch");
    bus.emit("hode:start", { goal: "open excel" });
    expect(dispatch.mock.calls.map(([event]) => event.type)).toEqual(["OPEN_APP"]);
  });

  it("greets back without starting an open Hode", async () => {
    const { bus, runtime } = setup();
    bus.emit("hode:start", { goal: "Hello body, can you listen to" });
    await settle();
    expect(runtime.getState()).toMatchObject({ phase: "idle", open: false });
  });
});

describe("hode:start from the web dashboard", () => {
  const COMMAND_PROMPT: InstalledApp = { id: "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\cmd.exe", name: "Command Prompt", kind: "desktop" };
  const WITH_SHELL = [...APPS, COMMAND_PROMPT];

  it("starts a Hode for the goal but never opens an app on this PC", async () => {
    const { bus, runtime } = setup(undefined, WITH_SHELL);
    const dispatch = vi.spyOn(runtime, "dispatch");
    bus.emit("hode:start", { goal: "open command prompt", source: "web" });
    await settle();
    const types = dispatch.mock.calls.map(([event]) => event.type);
    expect(types).not.toContain("OPEN_APP");
    expect(types.slice(0, 2)).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
  });

  it("still opens the app when the same goal comes from this PC", () => {
    const { bus, runtime } = setup(undefined, WITH_SHELL);
    const dispatch = vi.spyOn(runtime, "dispatch");
    bus.emit("hode:start", { goal: "open command prompt" });
    expect(dispatch.mock.calls.map(([event]) => event)).toMatchObject([{ type: "OPEN_APP", app: { name: "Command Prompt" } }]);
  });
});
