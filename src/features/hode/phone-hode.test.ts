import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { COPY } from "../../lib/copy";
import type { TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception, type MockApp } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { IphoneScene } from "../../stage/scenes/iphone";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { HodeRuntime } from "./runtime";

const GOAL = "turn on dark mode on my iphone";

async function settle(): Promise<void> {
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function setup(startOn: "iphone" | "excel" = "iphone") {
  const phone = new IphoneScene();
  let current: MockApp = startOn === "iphone" ? phone : new ExcelScene();
  const perception = new MockPerception(() => current);
  const bus = new LocalBus();
  const renders: { surface?: string; bounds?: unknown }[] = [];
  bus.on("overlay:render", ({ primitives, surface }) => renders.push({ surface, bounds: primitives.find((p) => p.kind === "highlight")?.bounds }));
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
  const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills: new MemorySkillStore(), bus, tts });
  const act = async (...ids: string[]) => {
    for (const id of ids) {
      phone.press(id, "left");
      perception.notifyLearnerAction();
      await settle();
    }
  };
  const start = async () => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent" });
    await settle();
  };
  const connectPhone = async () => {
    current = phone;
    perception.notifyLearnerAction();
    await settle();
  };
  return { runtime, renders, spoken, act, start, connectPhone, state: () => runtime.getState() };
}

describe("iPhone Dark Mode Hode", () => {
  it("teaches on the phone surface, correcting Wallpaper, until the screen turns dark", async () => {
    const h = setup();
    await h.start();
    expect(h.state()).toMatchObject({ phase: "guiding", stepIndex: 0 });
    expect(h.renders.at(-1)?.surface).toBe("phone");

    await h.act("app:Settings", "list:scroll", "row:Wallpaper");
    expect(h.state().action?.kind).toBe("correct");
    expect(h.spoken.at(-1)).toContain("That's Wallpaper");

    await h.act("nav:back", "row:Display & Brightness", "option:Dark");
    expect(h.state().phase).toBe("success");
    expect(h.state().learnedSkills).toEqual(["ios.settings.open", "ios.settings.display", "ios.appearance.dark_mode"]);
  });

  it("re-locates the target after a scroll without repeating itself", async () => {
    const h = setup();
    await h.start();
    await h.act("app:Settings");
    expect(h.state().action?.kind).toBe("clarify");
    expect(h.spoken.at(-1)).toBe(COPY.clarifyPhone);

    await h.act("list:scroll");
    expect(h.state().action?.kind).toBe("guide");
    expect(h.renders.at(-1)?.bounds).toBeDefined();
    // A tap that changes nothing re-checks the screen: same instruction, not said twice, not escalated.
    const said = h.spoken.length;
    const level = h.state().level;
    await h.act("row:Battery", "row:Battery");
    expect(h.spoken.length).toBe(said);
    expect(h.state().level).toBe(level);
  });

  it("waits for the iPhone when it isn't connected, then picks up", async () => {
    const h = setup("excel");
    await h.start();
    expect(h.spoken.at(-1)).toBe(COPY.connectPhone);
    await h.connectPhone();
    expect(h.state()).toMatchObject({ phase: "guiding", waitingForApp: undefined });
    expect(h.renders.at(-1)?.surface).toBe("phone");
  });
});
