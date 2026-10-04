import { describe, expect, it } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import type { HodeMode, ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { el, obs } from "./test-fixtures";

/** Open-ended Hodes (no task pack): the same teaching loop, with the vision model planning one step at a time. */

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
const reasonContexts = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "reason" }> => e.type === "reason").map((e) => e.context);

const FILE = el("File", "menu item", { bounds: { x: 0, y: 0, width: 40, height: 20 } });
const SAVE_AS = el("Save As", "menu item", { bounds: { x: 0, y: 30, width: 80, height: 20 } });
const START: ScreenObservation = { ...obs([FILE]), app: "Word", windowTitle: "Report - Word" };
const MENU_OPEN: ScreenObservation = { ...obs([FILE, SAVE_AS]), app: "Word", windowTitle: "Report - Word", at: 1, inputs: [{ kind: "click", at: { x: 5, y: 5 }, button: "left" }] };

const guide = (speech: string, level: TeachingAction["assistanceLevel"], target = FILE): TeachingAction => ({
  kind: "guide",
  speech,
  skill: "general.vision",
  assistanceLevel: level,
  target: { elementId: target.id, bounds: target.bounds, confidence: 0.9, label: target.name },
});

function begin(mode: HodeMode): Transition {
  return play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "save this as a PDF", openAllowed: true, mode }, { type: "OBSERVED", observation: START });
}

function firstInstruction(mode: HodeMode = "teach"): HodeState {
  const t = begin(mode);
  return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guide("Which menu holds saving options?", t.state.level), failures: [] }).state;
}

describe("a step done in an open-ended Hode", () => {
  it("is acknowledged when the model moves on after the learner acted, and the next step starts with a question again", () => {
    const raised = play(firstInstruction(), { type: "STUCK_TIMEOUT" }, { type: "STUCK_TIMEOUT" });
    const guided = play(raised.state, { type: "ACTION_READY", requestId: raised.state.requestId, action: guide("Open the File menu.", "guide"), failures: [] }).state;
    expect(guided.level).toBe("guide");
    const acted = play(guided, { type: "LEARNER_ACTED", observation: MENU_OPEN });
    const next = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Now choose Save As.", "guide", SAVE_AS), failures: [] });
    const ack = next.state.ack;
    expect(EN.stepDone).toContain(ack);
    expect(said(next)).toEqual([`${ack} Now choose Save As.`]);
    expect(next.state).toMatchObject({ openDone: ["Open the File menu."], level: "hint", escalated: false });
  });

  it("isn't counted done when the model repeats the step in other words", () => {
    const acted = play(firstInstruction(), { type: "LEARNER_ACTED", observation: MENU_OPEN });
    const again = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Which menu holds the saving options?", "hint"), failures: [] });
    expect(again.state.openDone ?? []).toEqual([]);
    expect(again.state.ack).toBeUndefined();
  });

  it("tells the model what was done so far, what it last said, and what the learner just did", () => {
    const acted = play(firstInstruction(), { type: "LEARNER_ACTED", observation: MENU_OPEN });
    const [context] = reasonContexts(acted);
    expect(context).toMatchObject({ openGoal: true, lastInstruction: "Which menu holds saving options?" });
    expect(context.recentActions?.length).toBe(1);
    const next = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Now choose Save As.", "hint", SAVE_AS), failures: [] });
    const later = play(next.state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: { ...MENU_OPEN, at: 2 } });
    expect(reasonContexts(later)[0]).toMatchObject({ doneSteps: ["Which menu holds saving options?"], lastInstruction: "Now choose Save As." });
  });

  it("lists the steps done on the success card", () => {
    const acted = play(firstInstruction(), { type: "LEARNER_ACTED", observation: MENU_OPEN });
    const next = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Now choose Save As.", "hint", SAVE_AS), failures: [] });
    const finished = play(next.state, { type: "LEARNER_ACTED", observation: { ...MENU_OPEN, elements: [FILE], at: 3 } });
    const done = play(finished.state, { type: "ACTION_READY", requestId: finished.state.requestId, action: { kind: "complete", speech: "Saved as a PDF. Well done.", skill: "general.vision", assistanceLevel: "hint" }, failures: [] });
    expect(done.state.phase).toBe("success");
    expect(notchView(done.state).steps?.map((item) => item.objective)).toEqual(["Which menu holds saving options?", "Now choose Save As."]);
  });
});

describe("Help mode with an open goal", () => {
  it("stands by instead of asking the model, until the learner asks or gets stuck", () => {
    const t = begin("help");
    expect(t.effects.some((e) => e.type === "reason")).toBe(false);
    expect(t.state.phase).toBe("guiding");
    expect(notchView(t.state).title).toBe(COPY.helpStandingBy);
    const acted = play(t.state, { type: "LEARNER_ACTED", observation: MENU_OPEN });
    expect(reasonContexts(acted)).toEqual([]);
    const asked = play(acted.state, { type: "HINT_REQUESTED" });
    expect(reasonContexts(asked)).toHaveLength(1);
    expect(asked.state.level).toBe("hint");
  });
});

describe("Explain in an open-ended Hode", () => {
  it("asks the model why this is the step, as a question about the screen", () => {
    const t = play(firstInstruction(), { type: "EXPLAIN_REQUESTED" });
    expect(t.state).toMatchObject({ phase: "observing", spokenQuestion: EN.whyThisStep });
    expect(notchView(firstInstruction()).controls).toContain("explain");
  });
});
