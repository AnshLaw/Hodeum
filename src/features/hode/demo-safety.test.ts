import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { TaskPack, TeachingAction } from "../../lib/types";
import { notchView } from "../../components/notch/notch-view";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, INSERT_SELECTED, PACK, el, guideAction, obs, tab } from "./test-fixtures";

/** What keeps a live demo moving when the screen can't be read the way the pack expects. */

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

/** A Teach Hode guiding step 1 (Insert) of `pack`. */
function guiding(pack: TaskPack = PACK): HodeState {
  return play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "make a pivot table", pack, mode: "teach" },
    { type: "SKILL_LOADED", skillId: pack.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] },
  ).state;
}

describe("\"I did it\": Hodey checks the screen instead of only looking again", () => {
  it("finishes the step when the fresh read shows it done, even though no click was seen", () => {
    const looked = play(guiding(), { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: INSERT_SELECTED });
    expect(looked.state).toMatchObject({ stepIndex: 1, phase: "observing" });
  });

  it("offers to skip ahead when it still can't see the step done", () => {
    const looked = play(guiding(), { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: HOME_SELECTED });
    const shown = play(looked.state, { type: "ACTION_READY", requestId: looked.state.requestId, action: guideAction({ assistanceLevel: "hint", speech: "Which tab adds things?" }), failures: [] });
    expect(shown.state).toMatchObject({ stepIndex: 0, phase: "guiding", offerSkip: true });
    const view = notchView(shown.state);
    // Next moves past it.
    expect(view.controls).toContain("next");
    expect(view.detail).toBe(EN.cantSeeItDone);
  });
});

describe("Skip: past a step Hodey can't see done", () => {
  it("moves to the next step without counting it as learned or failed", () => {
    const skipped = play(guiding(), { type: "SKIP_STEP" });
    expect(skipped.state).toMatchObject({ stepIndex: 1, phase: "observing", learnedSkills: [] });
    expect(skipped.effects.some((e) => e.type === "recordOutcome")).toBe(false);
    expect(skipped.effects.some((e) => e.type === "loadSkill")).toBe(true);
  });

  it("finishes the Hode when the last step is skipped, without claiming a skill was learned", () => {
    const last = { ...guiding(), stepIndex: 1 };
    const done = play(last, { type: "SKIP_STEP" });
    expect(done.state.phase).toBe("success");
    expect(said(done)).toEqual([EN.hodeCompleteSpeech]);
    expect(notchView(done.state).detail).toBeUndefined();
  });

  it("does nothing outside a lesson step", () => {
    expect(step(initialState, { type: "SKIP_STEP" }).state).toBe(initialState);
  });
});

describe("a reply nobody asked for", () => {
  const openGuiding = (): HodeState =>
    play(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "rename this document", openAllowed: true, mode: "teach" },
      { type: "OBSERVED", observation: obs([el("File", "menu item")]) },
    ).state;
  const answer: TeachingAction = { kind: "answer", speech: "Open the File menu.", skill: "general.vision", assistanceLevel: "hint", target: { elementId: "menu item:File", bounds: { x: 0, y: 0, width: 40, height: 20 }, confidence: 0.9, label: "File" } };

  it("is guidance, not an answer that folds away and silently ends the Hode", () => {
    const t = play(openGuiding(), { type: "ACTION_READY", requestId: 1, action: answer, failures: [] });
    expect(t.state).toMatchObject({ phase: "guiding", action: { kind: "guide" } });
    expect(play(t.state, { type: "DISMISS" }).state.phase).toBe("guiding");
  });

  it("\"complete\" in reply to a question is the question's answer, not the end of the Hode", () => {
    const asked = play(openGuiding(), { type: "ACTION_READY", requestId: 1, action: { ...answer, kind: "guide" }, failures: [] }, { type: "VOICE_QUESTION", question: "is that everything?" });
    const replied = play(asked.state, { type: "OBSERVED", observation: obs([el("File", "menu item")]) });
    const t = play(replied.state, { type: "ACTION_READY", requestId: replied.state.requestId, action: { ...answer, kind: "complete", speech: "Yes, you're done." }, failures: [] });
    expect(t.state.phase).toBe("answering");
  });
});

describe("clicks that aren't mistakes", () => {
  it("a click into the sheet's grid isn't a wrong action", () => {
    const grid = el("Grid", "data grid", { bounds: { x: 0, y: 100, width: 800, height: 600 } });
    const s = { ...guiding(), observation: obs([tab("Home", 0, true), tab("Insert", 1), tab("Data", 2), grid]) };
    const clicked = { ...obs([tab("Home", 0, true), tab("Insert", 1), tab("Data", 2), grid]), at: 1, inputs: [{ kind: "click" as const, at: { x: 200, y: 300 }, button: "left" as const }] };
    const t = play(s, { type: "LEARNER_ACTED", observation: clicked }, { type: "LEARNER_ACTED", observation: { ...clicked, at: 2 } });
    expect(t.state).toMatchObject({ wrongActions: 0, escalated: false, phase: "guiding" });
  });
});
