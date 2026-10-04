import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import { center, padRect } from "../../lib/coords";
import { spoken as spokenCopy } from "../../lib/spoken";
import type { ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import type { HodeMode } from "../../lib/types";
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
  const surfaces: string[] = [];
  bus.on("overlay:render", ({ primitives, surface }) => {
    overlays.push(primitives.map((p) => p.kind).join("+"));
    surfaces.push(surface ?? "unset");
  });
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
  const start = async (mode: HodeMode = "agent") => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode });
    await settle();
  };
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      const pressed = scene.snapshot().elements.find((e) => e.id === id);
      scene.press(id, "left");
      perception.notifyLearnerAction(pressed ? [{ kind: "click", at: center(pressed.bounds), button: "left" }] : []);
      await settle();
    }
  };
  return { scene, bus, runtime, overlays, surfaces, spoken, start, act, state: () => runtime.getState() };
}

const failing: ReasoningProvider = { id: "gemini", reason: () => Promise.reject(new Error("quota")), healthCheck: async () => false };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("HodeRuntime end to end", () => {
  it("tags Windows guidance with the windows surface", async () => {
    const h = setup();
    await h.start();
    expect(h.surfaces.at(-1)).toBe("windows");
  });

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

  it("shows Hodey thinking only while a slow reasoner works on the current request", async () => {
    let finish: () => void = () => undefined;
    const planner = new TaskPackReasoningProvider();
    const slow: ReasoningProvider = {
      id: "local-qwen3-vl",
      reason: (context, hooks) => {
        hooks?.onThinking?.();
        return new Promise((resolve) => (finish = () => resolve(planner.reason(context))));
      },
      healthCheck: async () => true,
    };
    const h = setup([slow]);
    await h.start();
    expect(h.state()).toMatchObject({ phase: "reasoning", thinking: true });
    finish();
    await settle();
    expect(h.state()).toMatchObject({ phase: "guiding" });
  });

  it("an action that changes nothing on screen leaves guidance alone: no reasoning, no speech", async () => {
    const reason = vi.fn((context) => new TaskPackReasoningProvider().reason(context));
    const h = setup([{ id: "local", reason, healthCheck: async () => true }]);
    await h.start();
    const calls = reason.mock.calls.length;
    const said = h.spoken.length;
    await h.act("nothing-here");
    expect(reason.mock.calls.length).toBe(calls);
    expect(h.spoken.length).toBe(said);
    expect(h.state()).toMatchObject({ phase: "guiding", wrongActions: 0 });
  });

  it("gives less help on a repeated skill in the next Hode", async () => {
    const skills = new MemorySkillStore();
    const first = setup(undefined, skills);
    await first.start();
    await first.act(...FULL_HODE);

    // Teach mode: a skill practised with full help starts the next Hode as a challenge.
    const second = setup(undefined, skills);
    await second.start("teach");
    await second.act("tab:Insert");
    expect(second.state()).toMatchObject({ stepIndex: 1, level: "hint" });
    expect(second.overlays.at(-1)).toBe("clear");
  });

  it("tells views once a step's skill progress is saved", async () => {
    const skills = new MemorySkillStore();
    const h = setup(undefined, skills);
    const saved: number[] = [];
    h.bus.on("data:changed", () => saved.push(skills.all().length));
    await h.start();
    await h.act("tab:Insert");
    expect(saved).toEqual([1]);
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
    await h.start("teach");
    expect(h.state().level).toBe("hint");
    vi.advanceTimersByTime(STUCK_MS);
    await settle();
    expect(h.state()).toMatchObject({ phase: "guiding", level: "guide" });
  });

  it("notices the learner clicking the same wrong tab again and again, and points at the right one", async () => {
    const h = setup();
    await h.start("teach");
    await h.act("tab:Home", "tab:Home", "tab:Home");
    expect(h.state()).toMatchObject({ phase: "guiding", stuck: { kind: "repeated_click", control: "Home" } });
    // Teach mode corrects with the why.
    const why = matchGoal(GOAL, TASK_PACKS)?.steps[0].explain;
    expect(h.spoken.at(-1)).toBe(`${spokenCopy("en").repeatedClick("Home")} ${why}`);
    expect(h.overlays.at(-1)).toContain("highlight");
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

describe("bringing the pack's app forward", () => {
  it("focuses the app before the first read of the screen", async () => {
    const scene = new ExcelScene();
    const perception = new MockPerception(() => scene);
    const order: string[] = [];
    let release: () => void = () => undefined;
    vi.spyOn(perception, "focusApp").mockImplementation(async (app) => {
      order.push(`focus ${app}`);
      await new Promise<void>((resolve) => (release = resolve));
      return true;
    });
    const observe = perception.observe.bind(perception);
    vi.spyOn(perception, "observe").mockImplementation((region) => {
      order.push("observe");
      return observe(region);
    });
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent" });
    await settle();
    expect(order).toEqual(["focus Excel"]);
    release();
    await settle();
    expect(order).toEqual(["focus Excel", "observe"]);
    expect(runtime.getState().phase).toBe("guiding");
  });
});

describe("what Hodey is saying", () => {
  it("is known while speaking and for a moment after, then forgotten", async () => {
    vi.useFakeTimers();
    const { start, runtime } = setup();
    await start();
    expect(runtime.hodeySaying()).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    expect(runtime.hodeySaying()).toBeUndefined();
  });
});

describe("Hodey finishing a sentence", () => {
  it("tells listeners when a line was spoken in full, but not when it was cut off", async () => {
    const { start, runtime } = setup();
    const finished = vi.fn();
    runtime.onSpeechFinished(finished);
    await start();
    expect(finished).toHaveBeenCalled();
    finished.mockClear();
    runtime.interruptSpeech();
    await settle();
    expect(finished).not.toHaveBeenCalled();
  });
});
