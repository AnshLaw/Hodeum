import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { center } from "../../lib/coords";
import type { AppSwitch, PerceptionAdapter, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../test-support/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { ACTION_SETTLE_MS, HodeRuntime, NATIVE_SWITCH_GRACE_MS } from "./runtime";

/** A learner's click is recognised on the first try, even when the app shows its result a moment later. */

const GOAL = "Teach me how to make a pivot table in Excel";

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

const tts: TTSProvider = {
  async speak(text) {
    for await (const chunk of text) void chunk;
  },
  async stop() {},
  async healthCheck() {
    return true;
  },
};

function setup(extra: Partial<PerceptionAdapter> = {}) {
  const scene = new ExcelScene();
  const mock = new MockPerception(() => scene);
  const perception: PerceptionAdapter = Object.assign(mock, extra);
  const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
  runtime.dispatch({ type: "START_HODE" });
  runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "teach" });
  return { scene, mock, runtime };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a click whose result shows a moment later", () => {
  it("finishes the step on the first try", async () => {
    vi.useFakeTimers();
    const { scene, mock, runtime } = setup();
    await settle();
    expect(runtime.getState()).toMatchObject({ phase: "guiding", stepIndex: 0 });
    const insert = scene.snapshot().elements.find((e) => e.id === "tab:Insert");
    if (!insert) throw new Error("The Excel scene has no Insert tab");
    // The read right after the click beats Excel's redraw: it still shows Home selected.
    mock.notifyLearnerAction([{ kind: "click", at: center(insert.bounds), button: "left" }]);
    scene.press("tab:Insert", "left");
    await settle();
    expect(runtime.getState().stepIndex).toBe(0);
    vi.advanceTimersByTime(ACTION_SETTLE_MS);
    await settle();
    expect(runtime.getState().stepIndex).toBe(1);
    runtime.dispose();
  });
});

describe("an app Hodey opened that no window watcher reports", () => {
  it("never leaves the learner marked as away", async () => {
    vi.useFakeTimers();
    const watcher = new Set<(window: AppSwitch) => void>();
    const { runtime } = setup({
      onAppSwitched: (handler) => {
        watcher.add(handler);
        return () => watcher.delete(handler);
      },
      openInstalledApp: async () => true,
    });
    await settle();
    expect(runtime.getState().phase).toBe("guiding");
    runtime.dispatch({ type: "OPEN_APP", app: { id: "settings", name: "Settings", kind: "packaged" }, said: "open settings" });
    await settle();
    vi.advanceTimersByTime(NATIVE_SWITCH_GRACE_MS);
    await settle();
    expect(runtime.isAway()).toBe(false);
    runtime.dispose();
  });
});
