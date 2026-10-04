import { describe, expect, it } from "vitest";
import { TASK_PACKS } from "../../task-packs";
import { routeUtterance } from "../voice/route";
import { initialState, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, guideAction } from "./test-fixtures";

/** What the learner can always say (PRD §7): "Give me a hint", "Show me", "Explain why", "Let me try", "Stop helping". */

function play(state: HodeState, ...events: HodeEvent[]): Transition {
  return events.reduce<Transition>(
    (t, event) => {
      const next = step(t.state, event);
      return { state: next.state, effects: [...t.effects, ...next.effects] };
    },
    { state, effects: [] },
  );
}

const hinting = (): HodeState =>
  play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" },
    { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] },
  ).state;

const route = (s: HodeState, text: string) => routeUtterance(s, text, TASK_PACKS, false);

describe("\"Show me\"", () => {
  it("goes straight to a full demonstration of the step, which then doesn't count as done unaided", () => {
    const t = play(hinting(), { type: "SHOW_ME" });
    expect(t.state).toMatchObject({ phase: "reasoning", level: "demonstrate", escalated: true });
    expect(t.effects.some((e) => e.type === "reason")).toBe(true);
  });

  it("is heard in English, Hindi and Hinglish", () => {
    const guiding = hinting();
    for (const said of ["show me", "just show me", "show me how", "दिखाओ", "करके दिखाओ", "dikhao", "karke dikhao"]) {
      expect(route(guiding, said)).toEqual([{ type: "SHOW_ME" }]);
    }
    expect(route(guiding, "show me all the steps")).toEqual([{ type: "SHOW_ALL_STEPS" }]);
  });
});

describe("\"Stop helping\"", () => {
  it("lets the learner carry on alone, like \"let me try\"", () => {
    const guiding = hinting();
    for (const said of ["stop helping", "stop helping me", "I've got this", "i got this"]) {
      expect(route(guiding, said)).toEqual([{ type: "LET_ME_TRY" }]);
    }
  });
});
