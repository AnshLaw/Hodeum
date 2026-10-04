import { describe, expect, it } from "vitest";
import type { ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, el, guideAction, obs } from "./test-fixtures";

/** Hodey notices what changed even without a click: another window coming forward, or Enter sending something. */

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

const BOX = el("Message #general", "edit", { bounds: { x: 300, y: 820, width: 1000, height: 44 } });
const DISCORD: ScreenObservation = { ...obs([BOX]), app: "Discord", windowTitle: "#general - Discord" };
const guide = (speech: string): TeachingAction => ({ kind: "guide", speech, skill: "general.vision", assistanceLevel: "hint", target: { elementId: BOX.id, bounds: BOX.bounds, confidence: 0.9, label: BOX.name } });

function openGuiding(): HodeState {
  const t = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "send a message", openAllowed: true, mode: "teach" }, { type: "OBSERVED", observation: DISCORD });
  return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guide("Where would you type a message?"), failures: [] }).state;
}

describe("another window coming forward", () => {
  it("makes an open-ended Hode look again (a fresh look, not the learner's action)", () => {
    const t = play(openGuiding(), { type: "APP_SWITCHED" });
    expect(t.state.phase).toBe("observing");
    expect(t.state.actedSinceInstruction).not.toBe(true);
    expect(types(t)).toContain("observe");
  });

  it("makes Hodey look again while it waits for the learner's app", () => {
    const waiting: HodeState = { ...openGuiding(), waitingForApp: "Discord" };
    expect(types(play(waiting, { type: "APP_SWITCHED" }))).toContain("observe");
  });

  it("leaves a lesson alone: a glance at another window isn't a step", () => {
    const lesson = play(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" },
      { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
      { type: "OBSERVED", observation: HOME_SELECTED },
      { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "hint" }), failures: [] },
    ).state;
    expect(play(lesson, { type: "APP_SWITCHED" }).effects).toEqual([]);
  });
});

describe("Enter", () => {
  it("is an action that matters in an open-ended Hode: sending a message asks what's next", () => {
    const sent: ScreenObservation = { ...DISCORD, at: 1, inputs: [{ kind: "submit" }] };
    const t = play(openGuiding(), { type: "LEARNER_ACTED", observation: sent });
    expect(types(t)).toContain("reason");
  });
});
