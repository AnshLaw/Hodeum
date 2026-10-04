import { describe, expect, it } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import { spoken } from "../../lib/spoken";
import type { ScreenObservation } from "../../lib/types";
import { appFromGoal } from "../../task-packs";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { el, obs } from "./test-fixtures";

/** "How do I open Excel?" is a lesson in opening it: waiting for Excel to be open first would be circular. */

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
const types = (t: Transition) => t.effects.map((e) => e.type);

const BROWSER: ScreenObservation = { ...obs([el("Address bar", "edit")]), app: "Chrome", windowTitle: "New Tab - Google Chrome" };
const EXCEL: ScreenObservation = { ...obs([el("Home", "tab item")]), app: "Excel", windowTitle: "Book1 - Excel", at: 1 };

function ask(goal: string, language: HodeState["language"] = "en"): Transition {
  return play({ ...initialState, language }, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal, openAllowed: true, app: appFromGoal(goal), mode: "teach" });
}

describe("a goal about opening an app", () => {
  it("doesn't open the app for the learner: it teaches how, from wherever they are", () => {
    const begun = ask("how to open excel");
    expect(types(begun)).not.toContain("focusApp");
    const taught = play(begun.state, { type: "OBSERVED", observation: BROWSER });
    expect(said(taught)).toEqual([EN.howToOpen("Excel")]);
    expect(taught.state).toMatchObject({ phase: "guiding", waitingForApp: "Excel" });
    expect(types(taught)).not.toContain("reason");
    expect(notchView(taught.state).title).toBe(EN.howToOpen("Excel"));
  });

  it("finishes the moment the app is open, without asking the vision model", () => {
    const taught = play(ask("how to open excel").state, { type: "OBSERVED", observation: BROWSER });
    const opened = play(taught.state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: EXCEL });
    expect(opened.state.phase).toBe("success");
    expect(said(opened).at(-1)).toBe(EN.openedIt("Excel"));
    expect(types(opened)).not.toContain("reason");
  });

  it("is heard in Hindi too", () => {
    const taught = play(ask("एक्सेल कैसे खोलें", "hi").state, { type: "OBSERVED", observation: BROWSER });
    expect(said(taught)).toEqual([spoken("hi").howToOpen("Excel")]);
  });

  it("keeps going after the app opens for other goals about an app (they wait for it, saying how to open it)", () => {
    for (const goal of ["make a chart in excel", "how do I start a new workbook in excel", "how do I open a file in excel"]) {
      const taught = play(ask(goal).state, { type: "OBSERVED", observation: BROWSER });
      expect(said(taught)).toEqual([EN.howToOpen("Excel")]);
      expect(taught.state.openingApp).toBe(false);
      const opened = play(taught.state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: EXCEL });
      expect(opened.state.phase).toBe("reasoning");
    }
  });

  it.each(["open excel", "how do I open Excel?", "launch microsoft excel", "excel kaise kholte hain", "open file explorer"])("treats %j as a goal of opening the app", (goal) => {
    expect(ask(goal).state.openingApp).toBe(true);
  });
});
