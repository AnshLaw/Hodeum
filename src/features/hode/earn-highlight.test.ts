import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { HodeMode } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, guideAction } from "./test-fixtures";

/**
 * Teach makes the learner work for it: a step's question comes alone while they try; only when they're
 * stuck (or ask) does the area that holds the answer light up; then the control; then a demonstration.
 */

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

const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);
const overlays = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "renderOverlay" }> => e.type === "renderOverlay").map((e) => e.primitives);
const types = (t: Transition) => t.effects.map((e) => e.type);

function hinting(mode: HodeMode = "teach"): Transition {
  const begun = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null });
  const level = begun.state.level;
  return play(begun.state, { type: "OBSERVED", observation: HOME_SELECTED }, { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: level, speech: "Which tab adds things?" }), failures: [] });
}

describe("Teach: the question first, on its own", () => {
  it("draws nothing while the learner tries", () => {
    const t = hinting();
    expect(t.state.level).toBe("hint");
    expect(overlays(t)).toEqual([]);
    expect(said(t).at(-1)).toContain("Which tab adds things?");
  });

  it("lights up the area when the learner is stuck, without a model call or a rung up", () => {
    const stuck = play(hinting().state, { type: "STUCK_TIMEOUT" });
    expect(stuck.state).toMatchObject({ level: "hint", areaShown: true, phase: "guiding" });
    expect(types(stuck)).not.toContain("reason");
    expect(overlays(stuck)[0]).toEqual([expect.objectContaining({ kind: "highlight", emphasis: "broad" })]);
    expect(said(stuck)).toEqual([EN.lookHere]);
  });

  it("does the same for a hint request or \"where?\"", () => {
    expect(play(hinting().state, { type: "HINT_REQUESTED" }).state.areaShown).toBe(true);
    expect(play(hinting().state, { type: "SAID_STUCK" }).state.areaShown).toBe(true);
  });

  it("then climbs as before: the control itself, then a demonstration", () => {
    const area = play(hinting().state, { type: "STUCK_TIMEOUT" });
    const raised = play(area.state, { type: "STUCK_TIMEOUT" });
    expect(raised.state).toMatchObject({ level: "guide", phase: "reasoning" });
  });

  it("starts each new step with the question alone again", () => {
    const area = play(hinting().state, { type: "STUCK_TIMEOUT" });
    const done = play(area.state, { type: "LEARNER_ACTED", observation: { ...HOME_SELECTED, elements: HOME_SELECTED.elements.map((e) => (e.name === "Insert" ? { ...e, selected: true } : { ...e, selected: false })), at: 1 } });
    expect(done.state).toMatchObject({ stepIndex: 1, areaShown: false });
  });
});

describe("Help and Agent", () => {
  it("show the area with a hint straight away: the learner already asked for help", () => {
    const helped = play(hinting("help").state, { type: "HINT_REQUESTED" });
    const shown = play(helped.state, { type: "ACTION_READY", requestId: helped.state.requestId, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] });
    expect(overlays(shown)[0]).toEqual([expect.objectContaining({ kind: "highlight", emphasis: "broad" })]);
  });
});
