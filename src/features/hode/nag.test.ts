import { describe, expect, it } from "vitest";
import type { ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, el, guideAction, obs, skillRecord, tab } from "./test-fixtures";

/**
 * Hodey never nags: a line the learner already heard isn't said again unless they ask, and the stuck
 * timer climbs the ladder once per step and then waits, in task-pack and open-ended Hodes alike.
 */

function fold(state: HodeState, ...events: HodeEvent[]): Transition {
  let t: Transition = { state, effects: [] };
  for (const event of events) t = step(t.state, event);
  return t;
}

const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);
const reasons = (t: Transition) => t.effects.filter((e) => e.type === "reason").length;

const FILE_MENU = "Open the File menu at the top left.";
/** A click on the File menu: an action that matters in an open-ended Hode. */
const CLICK_FILE = [{ kind: "click" as const, at: { x: 5, y: 5 }, button: "left" as const }];

function openGuide(speech = FILE_MENU, level: TeachingAction["assistanceLevel"] = "hint"): TeachingAction {
  return { kind: "guide", speech, skill: "general.vision", assistanceLevel: level, target: { elementId: "menu item:File", bounds: { x: 0, y: 0, width: 40, height: 20 }, confidence: 0.9, label: "File" } };
}

/** An open-ended Teach Hode (no task pack), guiding its first instruction. */
function openGuiding(): HodeState {
  return fold(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "rename this document", openAllowed: true, mode: "teach" },
    { type: "OBSERVED", observation: obs([el("File", "menu item")]) },
    { type: "ACTION_READY", requestId: 1, action: openGuide(), failures: [] },
  ).state;
}

/** Answers whatever reasoning is in flight with `action` (at the state's own level). */
function answer(t: Transition, action: (s: HodeState) => TeachingAction): Transition {
  if (t.state.phase !== "reasoning") return t;
  const next = step(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: action(t.state), failures: [] });
  return { state: next.state, effects: [...t.effects, ...next.effects] };
}

describe("the stuck timer climbs the ladder once, then waits", () => {
  it("stops re-asking the vision model in an open-ended Hode once it gives the most help", () => {
    let s = openGuiding();
    expect(s).toMatchObject({ phase: "guiding", open: true, level: "hint" });
    let asked = 0;
    for (let i = 0; i < 10; i++) {
      const t = answer(step(s, { type: "STUCK_TIMEOUT" }), (state) => openGuide(FILE_MENU, state.level));
      asked += reasons(t);
      s = t.state;
    }
    // hint → guide → demonstrate → one fresh look at the most help, then quiet.
    expect(asked).toBe(3);
    expect(s).toMatchObject({ phase: "guiding", level: "demonstrate", toppedOut: true });
    expect(step(s, { type: "STUCK_TIMEOUT" }).effects).toEqual([]);
  });

  it("starts climbing again after the learner does something that matters", () => {
    let s = openGuiding();
    for (let i = 0; i < 4; i++) s = answer(step(s, { type: "STUCK_TIMEOUT" }), (state) => openGuide(FILE_MENU, state.level)).state;
    expect(s.toppedOut).toBe(true);
    const menuOpen = { ...obs([el("File", "menu item"), el("Save As", "menu item")]), inputs: CLICK_FILE };
    const acted = answer(step(s, { type: "LEARNER_ACTED", observation: menuOpen }), (state) => openGuide("Choose Save As.", state.level));
    expect(acted.state.toppedOut).toBe(false);
    const area = step(acted.state, { type: "STUCK_TIMEOUT" });
    expect(reasons(area)).toBe(0);
    expect(reasons(step(area.state, { type: "STUCK_TIMEOUT" }))).toBe(1);
  });
});

describe("a line already heard isn't said again unless the learner asks", () => {
  it("an open-ended re-check that lands on the same instruction moves the highlight silently", () => {
    const s = openGuiding();
    const clicked = { ...obs([el("File", "menu item"), el("Home", "tab item", { selected: true })]), inputs: CLICK_FILE };
    const t = answer(step(s, { type: "LEARNER_ACTED", observation: clicked }), () => openGuide());
    expect(t.effects.some((e) => e.type === "reason")).toBe(true);
    expect(t.state.phase).toBe("guiding");
    expect(said(t)).toEqual([]);
    expect(t.effects.some((e) => e.type === "startStuckTimer")).toBe(true);
  });

  it("a newer action during reasoning that lands on the same instruction stays quiet", () => {
    const guiding = fold(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "teach me", pack: PACK, mode: "agent" },
      { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record: skillRecord("guide") },
      { type: "OBSERVED", observation: HOME_SELECTED },
      { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "guide", speech: "Open Insert." }), failures: [] },
    ).state;
    // A stray click on another tab's neighbour, then the re-plan says what's already on the card.
    const stray: ScreenObservation = { ...obs([tab("Home", 0, true), tab("Insert", 1), tab("Data", 2), el("Bold", "button", { bounds: { x: 0, y: 40, width: 20, height: 20 } })]), inputs: [{ kind: "click", at: { x: 5, y: 45 }, button: "left" }] };
    const reasoning = { ...step(guiding, { type: "LEARNER_ACTED", observation: stray }).state, phase: "reasoning" as const };
    const t = answer(step(reasoning, { type: "LEARNER_ACTED", observation: { ...stray, at: 1 } }), () => guideAction({ assistanceLevel: "guide", speech: "Open Insert." }));
    expect(said(t)).toEqual([]);
  });

  it("says the same line again when the learner asks for a hint", () => {
    let s = openGuiding();
    for (let i = 0; i < 4; i++) s = answer(step(s, { type: "STUCK_TIMEOUT" }), (state) => openGuide(FILE_MENU, state.level)).state;
    const t = answer(step(s, { type: "HINT_REQUESTED" }), (state) => openGuide(FILE_MENU, state.level));
    expect(said(t)).toEqual([FILE_MENU]);
  });

  it("says it again when the learner asks Hodey to look again", () => {
    const s = openGuiding();
    const looked = step(s, { type: "LOOK_AGAIN" });
    const t = answer(step(looked.state, { type: "OBSERVED", observation: obs([el("File", "menu item")]) }), () => openGuide());
    expect(said(t)).toEqual([FILE_MENU]);
  });
});
