import { describe, expect, it, vi } from "vitest";
import { LocalBus, type HodeSummary } from "../../lib/bus";
import { MemoryLearningStore } from "../../data/memory-stores";
import { DEFAULT_SETTINGS, MemorySettingsStore } from "../../data/settings";
import { LocalMemoryProvider } from "../../providers/memory/sqlite-memory";
import type { MemoryProvider } from "../../providers/interfaces";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { TASK_PACKS } from "../../task-packs";
import { connectHodeBridge, summaryOf } from "./bridge";
import { initialState } from "./model";
import { HodeRuntime } from "./runtime";
import { PACK, guideAction } from "./test-fixtures";

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setup(memory?: MemoryProvider) {
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
  connectHodeBridge({ runtime, bus, log: store, settings, packs: TASK_PACKS, openGoalsAllowed: () => false, applyVoice, memory });
  return { bus, store, settings, runtime, applyVoice };
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
    await settings.save({ ...DEFAULT_SETTINGS, voice: { enabled: false, rate: 1.3, name: "zira", conversation: true, handsFree: false, language: "en", hindiScript: "devanagari", hindiVoice: "kokoro:31", wakeWords: [] }, mode: "help", stuckSeconds: 20 });
    bus.emit("settings:changed", {});
    await settle();
    expect(applyVoice).toHaveBeenLastCalledWith({ enabled: false, rate: 1.3, name: "zira", conversation: true, handsFree: false, language: "en", hindiScript: "devanagari", hindiVoice: "kokoro:31", wakeWords: [] });
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
