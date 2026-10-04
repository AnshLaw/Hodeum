import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import type { HodePlan, TeachingAction } from "../../lib/types";
import type { PlannerProvider, ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { ExcelScene } from "../../test-support/scenes/excel";
import { HodeRuntime } from "./runtime";

/** The runtime plans an open Teach Hode in the background: reference steps, then the local model. */

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

const GOAL = "add a table";
const REFERENCE = "<web>[1] Insert a table</web>";
const PLAN: HodePlan = {
  concept: "A table turns a range into rows you can sort and filter.",
  steps: [{ objective: "Open the Insert tab", control: "Insert", hint: "Which tab adds things?", why: "It holds tables." }],
  recap: "You inserted a table from the Insert tab.",
};

const tts: TTSProvider = {
  async speak(text) {
    for await (const chunk of text) void chunk;
  },
  async stop() {},
  async healthCheck() {
    return true;
  },
};

/** Asks where Insert is, pointing at it, like the vision model would. */
function asker(scene: ExcelScene): ReasoningProvider {
  return {
    id: "stub",
    async reason(): Promise<TeachingAction> {
      const insert = scene.snapshot().elements.find((e) => e.id === "tab:Insert");
      if (!insert) throw new Error("The Excel scene has no Insert tab");
      return { kind: "guide", speech: "Which tab adds things?", skill: "general.vision", assistanceLevel: "hint", target: { elementId: insert.id, bounds: insert.bounds, confidence: 0.9, label: insert.name } };
    },
    async healthCheck() {
      return true;
    },
  };
}

function start(planner: PlannerProvider, planReference = vi.fn(async () => REFERENCE)) {
  const scene = new ExcelScene();
  const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [asker(scene)], skills: new MemorySkillStore(), bus: new LocalBus(), tts, planReference, planner });
  runtime.dispatch({ type: "START_HODE" });
  runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, openAllowed: true, mode: "teach" });
  return { runtime, planReference };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("planning an open Teach Hode in the background", () => {
  it("looks the goal up, plans it with the local model, and keeps the plan", async () => {
    const plan = vi.fn(async () => PLAN);
    const { runtime, planReference } = start({ plan });
    await settle();
    expect(runtime.getState().phase).toBe("guiding");
    expect(planReference).toHaveBeenCalledWith(GOAL, undefined, expect.any(AbortSignal));
    expect(plan).toHaveBeenCalledWith({ goal: GOAL, reference: REFERENCE, language: "en" }, expect.any(AbortSignal));
    expect(runtime.getState().plan).toEqual(PLAN);
    runtime.dispose();
  });

  it("gives the model to the learner's next step, and asks for the plan again once that step is answered", async () => {
    const signals: AbortSignal[] = [];
    const plan = vi.fn(async (_request: unknown, signal: AbortSignal): Promise<HodePlan> => {
      signals.push(signal);
      if (signals.length > 1) return PLAN;
      return new Promise<HodePlan>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("called off"))));
    });
    const { runtime } = start({ plan });
    await settle();
    expect(plan).toHaveBeenCalledTimes(1);
    // Stuck twice: the area lights up, then the next rung needs the model.
    runtime.dispatch({ type: "STUCK_TIMEOUT" });
    runtime.dispatch({ type: "STUCK_TIMEOUT" });
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(plan).toHaveBeenCalledTimes(2);
    expect(runtime.getState().plan).toEqual(PLAN);
    runtime.dispose();
  });

  it("carries on a step at a time when planning fails, and says why in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("The local model isn't running.");
    const { runtime } = start({ plan: async () => Promise.reject(failure) });
    await settle();
    expect(runtime.getState().phase).toBe("guiding");
    expect(runtime.getState().plan).toBeUndefined();
    expect(error).toHaveBeenCalledWith("Couldn't plan the Hode; Hodey plans it a step at a time", failure);
    runtime.dispose();
  });
});
