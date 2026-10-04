import { describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { ASSISTANCE_LEVELS, type AssistanceLevel, type HodeMode } from "../../lib/types";
import type { HodeLearningSummary, LearningMemory, MemoryProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../test-support/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { nudgeStartLevel, startLevel } from "../hode/policy";
import { HodeRuntime } from "../hode/runtime";
import { skillRecord } from "../hode/test-fixtures";
import { HodeMemoryTracker, rememberedLevel } from "./tracker";

const GOAL = "Teach me how to make a pivot table in Excel";
const INSERT = "excel.navigation.insert_tab";
const MODES: HodeMode[] = ["teach", "help", "agent"];
const steps = (a: AssistanceLevel, b: AssistanceLevel) => Math.abs(ASSISTANCE_LEVELS.indexOf(a) - ASSISTANCE_LEVELS.indexOf(b));

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

describe("nudgeStartLevel", () => {
  it("nudges the start level by at most one step", () => {
    for (const mode of MODES) {
      for (const saved of [null, ...ASSISTANCE_LEVELS.slice(0, -1).map((level) => skillRecord(level))]) {
        for (const remembered of ASSISTANCE_LEVELS) {
          const base = startLevel(mode, saved);
          expect(steps(nudgeStartLevel(mode, saved, remembered), base)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("moves one step toward what memory remembers", () => {
    expect(nudgeStartLevel("agent", null, "independent")).toBe("guide");
    expect(nudgeStartLevel("agent", skillRecord("guide"), "demonstrate")).toBe("demonstrate");
    // Help mode stands by until asked: memory can't make it start guiding.
    expect(nudgeStartLevel("help", skillRecord("observe"), "demonstrate")).toBe("observe");
    expect(nudgeStartLevel("teach", null, "observe")).toBe("observe");
    expect(nudgeStartLevel("teach", null, undefined)).toBe("hint");
  });

  it("never overrides a mastered skill record", () => {
    const mastered = { ...skillRecord("independent"), status: "mastered" as const };
    for (const mode of MODES) {
      for (const remembered of ASSISTANCE_LEVELS) expect(nudgeStartLevel(mode, mastered, remembered)).toBe(startLevel(mode, mastered));
    }
  });
});

describe("rememberedLevel", () => {
  it("takes the most recent remembered level for the skill and ignores notes without one", () => {
    const memories: LearningMemory[] = [
      { skillId: INSERT, note: "from Backboard" },
      { skillId: INSERT, note: "newer", level: "hint" },
      { skillId: INSERT, note: "older", level: "demonstrate" },
    ];
    expect(rememberedLevel(memories, INSERT)).toBe("hint");
    expect(rememberedLevel(memories, "excel.pivot.create")).toBeUndefined();
  });
});

function memoryFake(recalled: LearningMemory[] = []) {
  const stored: HodeLearningSummary[] = [];
  const memory: MemoryProvider = {
    getRelevantMemory: vi.fn(async () => recalled),
    storeLearningSummary: vi.fn(async (summary) => {
      stored.push(summary);
    }),
    healthCheck: async () => true,
  };
  return { memory, stored };
}

function setup(memory: MemoryProvider) {
  const scene = new ExcelScene();
  const perception = new MockPerception(() => scene);
  const tts = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
  const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts, memory });
  const tracker = new HodeMemoryTracker(memory);
  runtime.onTransition(tracker.observe);
  const start = async (mode: HodeMode) => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode });
    await settle();
  };
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      scene.press(id, "left");
      perception.notifyLearnerAction();
      await settle();
    }
  };
  return { runtime, tracker, start, act };
}

describe("learning memory in a Hode", () => {
  it("recalls by the pack's title and skills, never the learner's words, and nudges the first step", async () => {
    const { memory } = memoryFake([{ skillId: INSERT, note: "did it alone", level: "independent" }]);
    const h = setup(memory);
    await h.start("agent");
    expect(memory.getRelevantMemory).toHaveBeenCalledWith({ goal: "Make a PivotTable", skillIds: [INSERT, "excel.pivot.create", "excel.pivot.fields"] });
    expect(h.runtime.getState()).toMatchObject({ phase: "guiding", level: "guide" });
  });

  it("starts from the skill record alone when recall fails", async () => {
    const { memory } = memoryFake();
    vi.mocked(memory.getRelevantMemory).mockRejectedValueOnce(new Error("disk"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup(memory);
    await h.start("agent");
    expect(h.runtime.getState()).toMatchObject({ phase: "guiding", level: "demonstrate" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("stores one summary when the Hode completes, with the step that needed a correction", async () => {
    const { memory, stored } = memoryFake();
    const h = setup(memory);
    await h.start("agent");
    await h.act("tab:Data", "tab:Insert", "ribbon:PivotTable", "dialog:ok", "field:Region", "field:Sales");
    await h.tracker.flushed();
    expect(h.runtime.getState().phase).toBe("success");
    expect(stored).toEqual([
      expect.objectContaining({
        hode: "Make a PivotTable",
        completed: true,
        skills_practiced: [INSERT, "excel.pivot.create", "excel.pivot.fields"],
        needed_help_with: ["Open the Insert tab"],
        guided_steps: 5,
        independent_steps: 0,
        preferred_language: "en",
      }),
    ]);
  });

  it("stores an ended Hode too, and a failed save never stops the next Hode", async () => {
    const { memory } = memoryFake();
    vi.mocked(memory.storeLearningSummary).mockRejectedValueOnce(new Error("disk full"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup(memory);
    await h.start("agent");
    h.runtime.dispatch({ type: "END_HODE" });
    await h.tracker.flushed();
    expect(memory.storeLearningSummary).toHaveBeenCalledWith(expect.objectContaining({ completed: false, skills_practiced: [INSERT] }));
    expect(error).toHaveBeenCalledWith("Saving the learning summary failed", expect.any(Error));
    await h.start("agent");
    expect(h.runtime.getState().phase).toBe("guiding");
    error.mockRestore();
  });
});
