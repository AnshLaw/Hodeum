import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { padRect } from "../../lib/coords";
import type { ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { STUCK_MS } from "./model";
import { HodeRuntime } from "./runtime";

const GOAL = "Teach me how to make a pivot table in Excel";
const FULL_HODE = ["tab:Insert", "ribbon:PivotTable", "dialog:ok", "field:Region", "field:Sales"];

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setup(reasoners: ReasoningProvider[] = [new TaskPackReasoningProvider()], skills = new MemorySkillStore()) {
  const scene = new ExcelScene();
  const perception = new MockPerception(() => scene);
  const bus = new LocalBus();
  const overlays: string[] = [];
  bus.on("overlay:render", ({ primitives }) => overlays.push(primitives.map((p) => p.kind).join("+")));
  bus.on("overlay:clear", () => overlays.push("clear"));
  const spoken: string[] = [];
  const tts: TTSProvider = {
    async speak(text) {
      for await (const chunk of text) spoken.push(chunk);
    },
    async stop() {},
    async healthCheck() {
      return true;
    },
  };
  const runtime = new HodeRuntime({ perception, reasoners, skills, bus, tts });
  const start = async () => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS) });
    await settle();
  };
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      scene.press(id, "left");
      perception.notifyLearnerAction();
      await settle();
    }
  };
  return { scene, bus, runtime, overlays, spoken, start, act, state: () => runtime.getState() };
}

const failing: ReasoningProvider = { id: "gemini", reason: () => Promise.reject(new Error("quota")), healthCheck: async () => false };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HodeRuntime end to end", () => {
  it("teaches the Excel PivotTable Hode, correcting a wrong tab", async () => {
    const h = setup();
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: 0, level: "demonstrate" });
    expect(h.overlays.at(-1)).toBe("spotlight+highlight+arrow");
    expect(h.spoken.at(-1)).toBe("Click the Insert tab at the top. I've highlighted it.");

    await h.act("tab:Data");
    expect(h.state().action?.kind).toBe("correct");
    expect(h.spoken.at(-1)).toBe("You opened Data. Insert is further left, right after Home.");

    await h.act(...FULL_HODE);
    expect(h.state().phase).toBe("success");
    expect(h.state().learnedSkills).toEqual(["excel.navigation.insert_tab", "excel.pivot.create", "excel.pivot.fields"]);
    expect(h.spoken.at(-1)).toBe(COPY.hodeCompleteSpeech);
  });

  it("gives less help on a repeated skill in the next Hode", async () => {
    const skills = new MemorySkillStore();
    const first = setup(undefined, skills);
    await first.start();
    await first.act(...FULL_HODE);

    const second = setup(undefined, skills);
    await second.start();
    await second.act("tab:Insert");
    expect(second.state()).toMatchObject({ stepIndex: 1, level: "hint" });
    expect(second.overlays.at(-1)).toBe("clear");
  });

  it("falls back to the local planner when the first provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup([failing, new TaskPackReasoningProvider()]);
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", notice: COPY.fallbackNotice });
  });

  it("shows a recoverable state when every provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const h = setup([failing]);
    await h.start();
    expect(h.state().phase).toBe("recovering");
    expect(h.state().notice).toMatch(/^Hodey couldn't work out the next step/);
  });

  it("raises help when the learner is stuck", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const skills = new MemorySkillStore();
    await skills.recordOutcome("excel.navigation.insert_tab", { completed: true, mistakes: 0, level: "guide", escalated: false });
    const h = setup(undefined, skills);
    await h.start();
    expect(h.state().level).toBe("hint");
    vi.advanceTimersByTime(STUCK_MS);
    await settle();
    expect(h.state()).toMatchObject({ phase: "guiding", level: "guide" });
  });

  it("stays silent when muted", async () => {
    const h = setup();
    h.runtime.setMuted(true);
    await h.start();
    expect(h.spoken).toEqual([]);
  });

  it("answers Point & Ask questions over the bus", async () => {
    const h = setup();
    await h.start();
    const insert = h.scene.snapshot().elements.find((e) => e.id === "tab:Insert");
    if (!insert) throw new Error("Insert tab missing from scene");
    h.bus.emit("annotate:start", {});
    h.bus.emit("annotation:submitted", {
      annotation: { id: "q", shape: { kind: "rect", bounds: padRect(insert.bounds, 4) }, intent: "ask", question: "What is this?", createdAt: 0 },
    });
    await settle();
    expect(h.state().phase).toBe("answering");
    expect(h.state().action?.speech).toMatch(/^That's Insert\./);
    h.runtime.dispatch({ type: "DISMISS" });
    await settle();
    expect(h.state().phase).toBe("guiding");
  });
});
