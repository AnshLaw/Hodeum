import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, guideAction } from "./test-fixtures";

/** The learner can step into another app: the Hode's window stays open, so the step simply waits for them. */

const EN = spoken("en");

function play(state: HodeState, ...events: HodeEvent[]): Transition {
  return events.reduce<Transition>(
    (t, event) => {
      const next = step(t.state, event);
      return { state: next.state, effects: [...t.effects, ...next.effects] };
    },
    { state, effects: [] },
  );
}

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);
const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);

function guiding(): HodeState {
  return play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" },
    { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] },
  ).state;
}

describe("stepping into another app while the Hode's window stays open", () => {
  it("keeps the step and its card, says nothing, and stops the stuck timer", () => {
    const g = guiding();
    const away = play(g, { type: "APP_SWITCHED", away: true });
    expect(away.state).toMatchObject({ phase: "guiding", away: true, action: g.action });
    expect(types(away)).toEqual(["cancelStuckTimer"]);
  });

  it("doesn't count hesitation while the learner is away", () => {
    const away = play(guiding(), { type: "APP_SWITCHED", away: true });
    expect(play(away.state, { type: "STUCK_TIMEOUT" }).effects).toEqual([]);
  });

  it("takes a fresh look when they come back, without repeating the instruction", () => {
    const back = play(guiding(), { type: "APP_SWITCHED", away: true }, { type: "APP_SWITCHED", away: false });
    expect(back.state).toMatchObject({ phase: "observing", away: false });
    expect(types(back)).toContain("observe");
    const resumed = play(back.state, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 1 } });
    const shown = play(resumed.state, { type: "ACTION_READY", requestId: resumed.state.requestId, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] });
    expect(said(shown)).toEqual([]);
    expect(types(shown)).toContain("startStuckTimer");
  });

  it("keeps a step that's ready while they're away to say when they're back", () => {
    const raised = play(guiding(), { type: "STUCK_TIMEOUT" }, { type: "STUCK_TIMEOUT" });
    expect(raised.state.phase).toBe("reasoning");
    const next = guideAction({ assistanceLevel: "guide", speech: "Open the Insert tab." });
    const away = play(raised.state, { type: "APP_SWITCHED", away: true }, { type: "ACTION_READY", requestId: raised.state.requestId, action: next, failures: [] });
    expect(said(away)).toEqual([]);
    expect(types(away)).not.toContain("renderOverlay");
    const back = play(away.state, { type: "APP_SWITCHED", away: false });
    expect(types(back)).toContain("observe");
    const looked = play(back.state, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 2 } });
    const shown = play(looked.state, { type: "ACTION_READY", requestId: looked.state.requestId, action: next, failures: [] });
    expect(said(shown).join(" ")).toContain("Open the Insert tab.");
  });

  it("still answers a question asked from the other app", () => {
    const away = play(guiding(), { type: "APP_SWITCHED", away: true });
    expect(play(away.state, { type: "VOICE_QUESTION", question: "what does Insert do?" }).state.phase).toBe("observing");
  });
});

describe("a goal while the vision model is still loading", () => {
  it("says so, instead of saying there's no lesson for it", () => {
    const t = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "send a message on discord", visionStarting: true });
    expect(said(t)).toEqual([EN.visionLoading]);
    expect(t.state.notice).toBe(EN.visionLoading);
  });
});
