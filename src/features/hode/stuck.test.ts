import { describe, expect, it } from "vitest";
import type { LearnerInput, ScreenObservation, UiElement } from "../../lib/types";
import { detectStuck, type StepAction } from "./stuck";
import { HOME_SELECTED, PACK, el, obs, tab } from "./test-fixtures";

const OPEN_INSERT = PACK.steps[0];
const HOME_TAB = tab("Home", 0, true);
const HOME_CENTER = { x: 20, y: 10 };
const INSERT_CENTER = { x: 70, y: 10 };
const FAR_AWAY = { x: 900, y: 900 };

const click = (at = HOME_CENTER): LearnerInput => ({ kind: "click", at, button: "left" });
const withInputs = (observation: ScreenObservation, ...inputs: LearnerInput[]): ScreenObservation => ({ ...observation, inputs });

/** One learner action on an unchanged screen. */
function acted(before: ScreenObservation, after: ScreenObservation): StepAction {
  return { before, after };
}

function history(...afters: ScreenObservation[]): StepAction[] {
  return afters.map((after, i) => acted(i === 0 ? HOME_SELECTED : afters[i - 1], after));
}

const MENU = el("See more", "menu", { bounds: { x: 300, y: 40, width: 120, height: 200 } });
const withMenu = (...extra: UiElement[]) => obs([...HOME_SELECTED.elements, MENU, ...extra]);

describe("detectStuck: repeated clicks on the wrong control", () => {
  it("flags the third click in a row on the same wrong control", () => {
    const clicked = withInputs(HOME_SELECTED, click());
    expect(detectStuck(history(clicked, clicked), OPEN_INSERT, PACK)).toBeUndefined();
    expect(detectStuck(history(clicked, clicked, clicked), OPEN_INSERT, PACK)).toEqual({ kind: "repeated_click", control: "Home" });
  });

  it("ignores clicks on the step's target", () => {
    const onTarget = withInputs(HOME_SELECTED, click(INSERT_CENTER));
    expect(detectStuck(history(onTarget, onTarget, onTarget), OPEN_INSERT, PACK)).toBeUndefined();
  });

  it("ignores clicks inside a target that is a container (a file in the list to right-click)", () => {
    const list = el("Items View", "list", { bounds: { x: 0, y: 100, width: 400, height: 300 } });
    const file = el("report.docx", "list item", { bounds: { x: 10, y: 110, width: 300, height: 30 } });
    const screen = obs([list, file]);
    const step = { ...OPEN_INSERT, target: { names: ["Items View"], role: "list" } };
    const onFile = withInputs(screen, click({ x: 50, y: 120 }));
    const actions = [acted(screen, onFile), acted(onFile, onFile), acted(onFile, onFile)];
    expect(detectStuck(actions, step, PACK)).toBeUndefined();
  });

  it("doesn't count clicks on empty space or different controls as a streak", () => {
    const blank = withInputs(HOME_SELECTED, click(FAR_AWAY));
    expect(detectStuck(history(blank, blank, blank), OPEN_INSERT, PACK)).toBeUndefined();
    const home = withInputs(HOME_SELECTED, click());
    const data = withInputs(HOME_SELECTED, click({ x: 120, y: 10 }));
    expect(detectStuck(history(home, data, home), OPEN_INSERT, PACK)).toBeUndefined();
  });

  it("never treats a whole window or pane as the clicked control", () => {
    const pane = obs([HOME_TAB, tab("Insert", 1), el("Book1 - Excel", "window", { bounds: { x: 0, y: 0, width: 2000, height: 2000 } })]);
    const onPane = withInputs(pane, click(FAR_AWAY));
    expect(detectStuck([acted(pane, onPane), acted(onPane, onPane), acted(onPane, onPane)], OPEN_INSERT, PACK)).toBeUndefined();
  });
});

describe("detectStuck: menu loops", () => {
  it("flags opening, closing and reopening the same wrong menu", () => {
    expect(detectStuck(history(withMenu(), HOME_SELECTED), OPEN_INSERT, PACK)).toBeUndefined();
    expect(detectStuck(history(withMenu(), HOME_SELECTED, withMenu()), OPEN_INSERT, PACK)).toEqual({ kind: "menu_loop", menu: "See more" });
  });

  it("leaves a menu that holds the step's target alone", () => {
    const insideMenu = tab("Insert", 0);
    const rightMenu = () => withMenu({ ...insideMenu, bounds: { x: 310, y: 50, width: 40, height: 20 } });
    const step = { ...OPEN_INSERT, target: { names: ["Insert"] } };
    expect(detectStuck(history(rightMenu(), HOME_SELECTED, rightMenu()), step, PACK)).toBeUndefined();
  });
});

describe("detectStuck: undo and back loops", () => {
  it("flags two undo or back actions in a row", () => {
    const undo = withInputs(HOME_SELECTED, { kind: "undo" });
    const back = withInputs(HOME_SELECTED, { kind: "back" });
    expect(detectStuck(history(undo), OPEN_INSERT, PACK)).toBeUndefined();
    expect(detectStuck(history(undo, back), OPEN_INSERT, PACK)).toEqual({ kind: "undo_loop" });
    expect(detectStuck(history(withInputs(HOME_SELECTED, { kind: "undo" }, { kind: "undo" })), OPEN_INSERT, PACK)).toEqual({ kind: "undo_loop" });
  });

  it("resets the count when the learner does something else in between", () => {
    const undo = withInputs(HOME_SELECTED, { kind: "undo" });
    expect(detectStuck(history(undo, withInputs(HOME_SELECTED, click(FAR_AWAY)), undo), OPEN_INSERT, PACK)).toBeUndefined();
  });
});

describe("detectStuck: surprise dialogs", () => {
  const ERROR = el("Microsoft Excel", "dialog");

  it("flags a dialog that appears and isn't part of the task", () => {
    expect(detectStuck(history(obs([...HOME_SELECTED.elements, ERROR])), OPEN_INSERT, PACK)).toEqual({ kind: "surprise_dialog", title: "Microsoft Excel" });
  });

  it("flags an extra window inside the app, but not the app's own window", () => {
    const own = { ...obs([el("Book1 - Excel", "window"), ...HOME_SELECTED.elements]) };
    expect(detectStuck(history(own), OPEN_INSERT, PACK)).toBeUndefined();
    expect(detectStuck(history(obs([...own.elements, el("Format Cells", "window")])), OPEN_INSERT, PACK)).toEqual({ kind: "surprise_dialog", title: "Format Cells" });
  });

  it("ignores dialogs the task pack expects, and ones already open when the step began", () => {
    const expected = { ...OPEN_INSERT, success: { kind: "element_visible" as const, names: ["Create PivotTable"] } };
    expect(detectStuck(history(obs([...HOME_SELECTED.elements, el("Create PivotTable", "window")])), expected, PACK)).toBeUndefined();
    const already = obs([...HOME_SELECTED.elements, ERROR]);
    expect(detectStuck([acted(already, already)], OPEN_INSERT, PACK)).toBeUndefined();
  });
});

describe("detectStuck: the expected control stays missing", () => {
  it("flags the target still absent after three actions", () => {
    const noInsert = obs([HOME_TAB]);
    expect(detectStuck(history(noInsert, noInsert), OPEN_INSERT, PACK)).toBeUndefined();
    expect(detectStuck(history(noInsert, noInsert, noInsert), OPEN_INSERT, PACK)).toEqual({ kind: "target_missing", target: "Insert" });
  });

  it("stays quiet while the target is on screen", () => {
    expect(detectStuck(history(HOME_SELECTED, HOME_SELECTED, HOME_SELECTED), OPEN_INSERT, PACK)).toBeUndefined();
  });
});
