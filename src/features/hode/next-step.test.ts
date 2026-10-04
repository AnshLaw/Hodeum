import { describe, expect, it } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import type { ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, INSERT_SELECTED, PACK, el, guideAction, obs } from "./test-fixtures";

/** "Next": the learner has done what Hodey asked and wants to move on. */

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
const outcomes = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "recordOutcome" }> => e.type === "recordOutcome");

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

describe("Next in a lesson", () => {
  it("is on the step's card", () => {
    expect(notchView(guiding()).controls[0]).toBe("next");
  });

  it("takes one fresh look, and a step that shows done is confirmed as usual", () => {
    const looking = play(guiding(), { type: "NEXT_STEP" });
    expect(types(looking)).toContain("observe");
    const done = play(looking.state, { type: "OBSERVED", observation: { ...INSERT_SELECTED, at: 5 } });
    expect(done.state.stepIndex).toBe(1);
    expect(outcomes(done)).toMatchObject([{ outcome: { completed: true } }]);
  });

  it("moves past a step it can't see done, without counting it as learned", () => {
    const moved = play(guiding(), { type: "NEXT_STEP" }, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 5 } });
    expect(moved.state.stepIndex).toBe(1);
    expect(moved.state.learnedSkills).toEqual([]);
    expect(outcomes(moved)).toEqual([]);
  });

  it("does nothing while a question is being answered", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "what does Insert do?" });
    expect(play(asked.state, { type: "NEXT_STEP" }).effects).toEqual([]);
  });
});

describe("Next in an open goal", () => {
  const BOX = el("Message #general", "edit", { bounds: { x: 100, y: 500, width: 600, height: 40 } });
  const CHAT: ScreenObservation = { ...obs([BOX]), app: "Discord", windowTitle: "#general - Discord" };
  const guide = (speech: string): TeachingAction => ({ kind: "guide", speech, skill: "general.vision", assistanceLevel: "guide", target: { elementId: BOX.id, bounds: BOX.bounds, confidence: 0.9, label: BOX.name } });

  it("counts the instruction done and asks for the step after it", () => {
    const begun = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "send a message on discord", openAllowed: true, mode: "teach" }, { type: "OBSERVED", observation: CHAT });
    const shown = play(begun.state, { type: "ACTION_READY", requestId: begun.state.requestId, action: guide("Click the message box."), failures: [] });
    expect(notchView(shown.state).controls[0]).toBe("next");
    const next = play(shown.state, { type: "NEXT_STEP" });
    expect(types(next)).toContain("observe");
    const asked = play(next.state, { type: "OBSERVED", observation: { ...CHAT, at: 5 } });
    const reason = asked.effects.find((e): e is Extract<HodeEffect, { type: "reason" }> => e.type === "reason");
    expect(reason?.context.doneSteps).toEqual(["Click the message box."]);
  });
});
