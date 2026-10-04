import { describe, expect, it } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import { spoken } from "../../lib/spoken";
import type { HodeMode, TaskPack } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, guideAction, skillRecord } from "./test-fixtures";

/** How a Teach Hode ends (docs/teach-loop.md): recap, one recall question, then an optional practice round. */

const EN = spoken("en");
const RECAP = "You made a PivotTable: Insert, then PivotTable.";
const CHECK = { question: "Quick check: which tab do you start from?", options: ["Insert", "Data", "Home"], answer: 0, explain: "Insert holds everything you add." };
const TAUGHT: TaskPack = { ...PACK, recap: RECAP, check: CHECK };

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

/** A Hode on its last step, about to be finished by the learner. */
function lastStep(mode: HodeMode, pack: TaskPack = TAUGHT): HodeState {
  const first = play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "make a pivot table", pack, mode },
    { type: "SKILL_LOADED", skillId: pack.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: mode === "agent" ? "demonstrate" : "hint" }), failures: [] },
    { type: "LEARNER_ACTED", observation: INSERT_SELECTED },
    { type: "SKILL_LOADED", skillId: pack.steps[1].skill, record: null },
  );
  return play(first.state, { type: "ACTION_READY", requestId: first.state.requestId, action: guideAction({ assistanceLevel: first.state.level, speech: "Far left." }), failures: [] }).state;
}

const finish = (s: HodeState) => play(s, { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE });

describe("recap and check: a finished Teach Hode ends with the moves and one question", () => {
  it("says the moves and asks the question, and the card waits with the answers to pick from", () => {
    const done = finish(lastStep("teach"));
    expect(done.state).toMatchObject({ phase: "success", review: { check: CHECK } });
    expect(said(done)).toEqual([`${EN.hodeCompleteSpeech} ${RECAP} ${CHECK.question}`]);
    const view = notchView(done.state);
    expect(view.detail).toBe(CHECK.question);
    expect(view.choices).toEqual(CHECK.options.map((label) => ({ label, state: "open" })));
  });

  it("confirms a right answer with the idea behind it", () => {
    const answered = play(finish(lastStep("teach")).state, { type: "REVIEW_ANSWERED", option: 0 });
    expect(said(answered)).toEqual([`${EN.reviewRight[0]} ${CHECK.explain}`]);
    expect(notchView(answered.state).choices?.map((c) => c.state)).toEqual(["right", "open", "open"]);
  });

  it("puts a wrong answer right, kindly, with the idea behind it", () => {
    const answered = play(finish(lastStep("teach")).state, { type: "REVIEW_ANSWERED", option: 1 });
    expect(said(answered)).toEqual([`${EN.reviewWrong("Insert")} ${CHECK.explain}`]);
    expect(notchView(answered.state).choices?.map((c) => c.state)).toEqual(["answer", "wrong", "open"]);
  });

  it("takes a spoken answer, and asks again for one it can't place", () => {
    const done = finish(lastStep("teach")).state;
    expect(said(play(done, { type: "REVIEW_ANSWERED", said: "it's the insert tab" }))).toEqual([`${EN.reviewRight[0]} ${CHECK.explain}`]);
    const unplaced = play(done, { type: "REVIEW_ANSWERED", said: "no idea" });
    expect(said(unplaced)).toEqual([EN.pickAnAnswer]);
    expect(unplaced.state.review?.picked).toBeUndefined();
  });

  it("only takes the first answer", () => {
    const answered = play(finish(lastStep("teach")).state, { type: "REVIEW_ANSWERED", option: 1 });
    expect(play(answered.state, { type: "REVIEW_ANSWERED", option: 0 }).effects).toEqual([]);
  });

  it("is Teach's alone: Help and Agent just finish", () => {
    for (const mode of ["help", "agent"] as const) {
      const done = finish(lastStep(mode));
      expect(done.state.review).toBeUndefined();
      expect(said(done).at(-1)).toBe(EN.hodeCompleteSpeech);
    }
  });

  it("without a recap or a question, a Teach Hode just finishes", () => {
    const done = finish(lastStep("teach", PACK));
    expect(done.state.review).toBeUndefined();
    expect(said(done).at(-1)).toBe(EN.hodeCompleteSpeech);
  });
});

describe("practise alone: the same Hode again, with Hodey only watching", () => {
  it("is offered on a finished Teach Hode", () => {
    expect(notchView(finish(lastStep("teach")).state).controls).toContain("practice");
    expect(notchView(finish(lastStep("agent")).state).controls).not.toContain("practice");
  });

  it("starts the same lesson with every step watched, not prompted, after a short word on what's happening", () => {
    const again = play(finish(lastStep("teach")).state, { type: "PRACTICE_AGAIN" });
    expect(again.state).toMatchObject({ phase: "observing", practice: true, mode: "teach", stepIndex: 0, learnedSkills: [] });
    expect(again.effects).toContainEqual({ type: "focusApp", app: "Excel" });
    const loaded = play(again.state, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: skillRecord("hint") }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(loaded.state.level).toBe("observe");
    const shown = play(loaded.state, { type: "ACTION_READY", requestId: loaded.state.requestId, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] });
    expect(said(shown)).toEqual([EN.practiceIntro]);
  });

  it("ends by saying the learner did it all on their own, with no question this time", () => {
    const again = play(finish(lastStep("teach")).state, { type: "PRACTICE_AGAIN" }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null }, { type: "OBSERVED", observation: HOME_SELECTED });
    const first = play(again.state, { type: "ACTION_READY", requestId: again.state.requestId, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] }, { type: "LEARNER_ACTED", observation: INSERT_SELECTED }, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null });
    const second = play(first.state, { type: "ACTION_READY", requestId: first.state.requestId, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] });
    const done = finish(second.state);
    expect(done.state).toMatchObject({ phase: "success" });
    expect(done.state.review).toBeUndefined();
    expect(said(done).at(-1)).toBe(`${EN.didItAlone} ${RECAP}`);
  });
});
