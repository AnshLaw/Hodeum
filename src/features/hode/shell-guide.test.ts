import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { ScreenObservation, UiElement } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, el, obs } from "./test-fixtures";

/** Opening the app a goal needs: Hodey points at the taskbar's search box, or says the Windows-key way. */

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
const renders = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "renderOverlay" }> => e.type === "renderOverlay");
const types = (t: Transition) => t.effects.map((e) => e.type);

const BROWSER: ScreenObservation = { ...obs([el("Address bar", "edit")]), app: "Chrome", windowTitle: "New Tab - Google Chrome" };
const SEARCH: UiElement = el("Search", "edit", { id: "shell:search", bounds: { x: 300, y: 1040, width: 220, height: 36 } });
const START: UiElement = el("Start", "button", { id: "shell:start", bounds: { x: 250, y: 1040, width: 44, height: 36 } });

function waiting(): Transition {
  const begun = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "how do I send a message on discord", openAllowed: true, app: "Discord", mode: "teach" });
  return play(begun.state, { type: "OBSERVED", observation: BROWSER });
}

describe("an open-ended Hode whose app isn't in front", () => {
  it("reads the taskbar before saying how to open the app; the card shows the way meanwhile", () => {
    const t = waiting();
    expect(types(t)).toContain("observeShell");
    expect(said(t)).toEqual([]);
    expect(t.state).toMatchObject({ phase: "guiding", waitingForApp: "Discord", action: { speech: EN.howToOpen("Discord") } });
  });

  it("rings the search box on the taskbar and says to click it, type the app, press Enter", () => {
    const t = play(waiting().state, { type: "SHELL_OBSERVED", elements: [START, SEARCH] });
    expect(said(t)).toEqual([EN.searchToOpen("Search", "Discord")]);
    const [render] = renders(t);
    expect(render).toMatchObject({ screen: true, primitives: [{ kind: "highlight", bounds: SEARCH.bounds, label: "Search", emphasis: "precise" }] });
    expect(t.state.action?.speech).toBe(EN.searchToOpen("Search", "Discord"));
  });

  it("with a taskbar on each monitor, rings the one on the monitor the learner's window is on", () => {
    const begun = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "how do I send a message on discord", openAllowed: true, app: "Discord", mode: "teach" });
    const onSecond: ScreenObservation = { ...BROWSER, window: { id: 3, bounds: { x: 1920, y: 0, width: 1920, height: 1040 } } };
    const t = play(begun.state, { type: "OBSERVED", observation: onSecond });
    const secondSearch = el("Search", "edit", { id: "shell:search:2", bounds: { x: 2220, y: 1040, width: 220, height: 36 } });
    const ringed = play(t.state, { type: "SHELL_OBSERVED", elements: [SEARCH, secondSearch] });
    expect(renders(ringed)[0].primitives[0]).toMatchObject({ bounds: secondSearch.bounds });
  });

  it("rings Start when there's no search box", () => {
    const t = play(waiting().state, { type: "SHELL_OBSERVED", elements: [START] });
    expect(said(t)).toEqual([EN.searchToOpen("Start", "Discord")]);
    expect(renders(t)[0].primitives[0]).toMatchObject({ bounds: START.bounds, label: "Start" });
  });

  it("says the Windows-key way when the taskbar can't be read", () => {
    const t = play(waiting().state, { type: "SHELL_OBSERVED", elements: [] });
    expect(said(t)).toEqual([EN.howToOpen("Discord")]);
    expect(renders(t)).toEqual([]);
  });

  it("ignores a taskbar read that comes back after the app was already opened", () => {
    const opened = play(waiting().state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: { ...BROWSER, app: "Discord", at: 1 } });
    expect(play(opened.state, { type: "SHELL_OBSERVED", elements: [SEARCH] }).effects).toEqual([]);
  });
});

describe("a lesson's app", () => {
  it("is never looked for on the taskbar: its practice file opens by itself", () => {
    const begun = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null });
    const t = play(begun.state, { type: "OBSERVED", observation: { ...HOME_SELECTED, app: "Word" } });
    expect(types(t)).not.toContain("observeShell");
    expect(said(t)).toEqual([EN.switchToApp("Excel")]);
  });
});
