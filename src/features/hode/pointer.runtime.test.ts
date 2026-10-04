import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import type { Point, TeachingAction, TeachingContext } from "../../lib/types";
import type { ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { ExcelScene } from "../../test-support/scenes/excel";
import { HodeRuntime } from "./runtime";

/** The runtime sends the pointer with each request, and watches it while Hodey asks where the learner is working. */

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

/** Never sure which control is meant, with nothing to say instead: Hodey ends up asking where the learner is working. */
function unsure(seen: TeachingContext[]): ReasoningProvider {
  return {
    id: "stub",
    async reason(context): Promise<TeachingAction> {
      seen.push(context);
      return { kind: "guide", speech: "", skill: "general.vision", assistanceLevel: "guide", target: { elementId: "x", bounds: { x: 0, y: 0, width: 10, height: 10 }, confidence: 0.2, label: "Insert" } };
    },
    async healthCheck() {
      return true;
    },
  };
}

function start(pointer: () => Promise<Point>) {
  const scene = new ExcelScene();
  const seen: TeachingContext[] = [];
  const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [unsure(seen)], skills: new MemorySkillStore(), bus: new LocalBus(), tts, pointer });
  runtime.dispatch({ type: "START_HODE" });
  runtime.dispatch({ type: "GOAL_SUBMITTED", goal: "add a table", openAllowed: true, mode: "teach" });
  return { runtime, seen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the learner's pointer", () => {
  it("goes with each request to the model", async () => {
    const { runtime, seen } = start(async () => ({ x: 7, y: 8 }));
    await settle();
    expect(seen[0]?.pointer).toEqual({ x: 7, y: 8 });
    runtime.dispose();
  });

  it("answers Hodey's question once it moves and comes to rest, and the next look uses it", async () => {
    vi.useFakeTimers();
    let at: Point = { x: 100, y: 100 };
    const { runtime, seen } = start(async () => at);
    await settle();
    expect(runtime.getState().action?.kind).toBe("clarify");
    const asked = seen.length;
    const tick = async (times: number) => {
      for (let i = 0; i < times; i++) {
        vi.advanceTimersByTime(150);
        await settle();
      }
    };
    await tick(3);
    at = { x: 400, y: 300 };
    await tick(8);
    expect(seen.length).toBeGreaterThan(asked);
    expect(seen.at(-1)?.pointer).toEqual({ x: 400, y: 300 });
    runtime.dispose();
  });

  it("is left out, and logged once, when it can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runtime, seen } = start(async () => Promise.reject(new Error("not allowed")));
    await settle();
    expect(seen[0]).not.toHaveProperty("pointer");
    expect(error.mock.calls.filter(([message]) => message === "Couldn't read the pointer; Hodey works without it")).toHaveLength(1);
    runtime.dispose();
  });
});
