import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import type { ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { createHowToLookup } from "../../providers/web/lookup";
import { spokenReference } from "../../providers/web/reference";
import type { WebSearch } from "../../providers/web/types";
import { ExcelScene } from "../../test-support/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { HodeRuntime } from "../hode/runtime";
import { routeUtterance } from "./route";

/**
 * End-to-end from what the learner says to what reaches the web: the real router, runtime, reducer and
 * lookup. Only the screen and the search service are mocks.
 */

const SETTLE_TICKS = 100;
const LESSON = "make a pivot table";
/** The personal details said below. None of them may reach the search service. */
const PERSONAL = /jane|doe|example|acme|intranet|payroll|salaries|xlsx|anshr|users/i;

async function settle(): Promise<void> {
  for (let i = 0; i < SETTLE_TICKS; i++) await Promise.resolve();
}

/** The screen-first answer points at nothing, so Hodey looks a how/where question up on its own. */
const pointsAtNothing: ReasoningProvider = {
  id: "local",
  reason: async () => ({ kind: "answer", speech: "I can't see that here.", skill: "general", assistanceLevel: "guide" }),
  healthCheck: async () => true,
};
const quiet: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };

function setup() {
  const sent: string[] = [];
  const search = async (query: string): Promise<WebSearch> => (sent.push(query), { query, results: [] });
  const reference = spokenReference(createHowToLookup({ web: { search }, webEnabled: () => true }), () => () => undefined);
  const scene = new ExcelScene();
  const runtime = new HodeRuntime({ perception: new MockPerception(() => scene), reasoners: [pointsAtNothing], skills: new MemorySkillStore(), bus: new LocalBus(), tts: quiet, reference });
  const say = async (text: string) => {
    routeUtterance(runtime.getState(), text, TASK_PACKS, false).forEach((event) => runtime.dispatch(event));
    await settle();
  };
  /** Idle, a how-to request is planned into a Hode; during one, a spoken question is answered from the screen first. */
  const inHode = async () => {
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: LESSON, pack: matchGoal(LESSON, TASK_PACKS), openAllowed: false });
    await settle();
  };
  return { sent, say, inHode };
}

describe("a spoken question taken to the web", () => {
  it("carries no email, link, path or file name the learner said when they ask Hodey to look it up", async () => {
    const { sent, say } = setup();
    await say("look up how to email jane.doe@example.com from outlook");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^how to email from outlook/);
    expect(sent[0]).not.toMatch(PERSONAL);
  });

  it("nor when Hodey looks it up on its own because the screen couldn't answer", async () => {
    const { sent, say, inHode } = setup();
    await inHode();
    await say(String.raw`How do I attach C:\Users\anshr\Q3-salaries.xlsx to a message on www.acme-intranet.com/payroll?`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^how to attach to a message on/);
    expect(sent[0]).not.toMatch(PERSONAL);
  });
});
