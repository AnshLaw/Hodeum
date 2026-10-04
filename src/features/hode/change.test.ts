import { describe, expect, it } from "vitest";
import type { ScreenObservation } from "../../lib/types";
import { assessAction, describeChange, diffScreens, isUnchanged, summarizeActions } from "./change";
import { HOME_SELECTED, INSERT_SELECTED, PACK, el, obs, tab } from "./test-fixtures";

const STEP = PACK.steps[0];
const PIVOT_STEP = PACK.steps[1];
const click = (x: number, y: number): ScreenObservation["inputs"] => [{ kind: "click", at: { x, y }, button: "left" }];
const later = (observation: ScreenObservation, extra: Partial<ScreenObservation> = {}): ScreenObservation => ({ ...observation, at: observation.at + 1000, ...extra });

describe("diffScreens", () => {
  it("sees nothing when only the read time, element ids and sub-pixel jitter differ", () => {
    const jittered = obs(HOME_SELECTED.elements.map((e, i) => ({ ...e, id: `uia:${i + 40}`, bounds: { ...e.bounds, x: e.bounds.x + 2 } })));
    expect(isUnchanged(diffScreens(HOME_SELECTED, later(jittered)))).toBe(true);
  });

  it("ignores hover tooltips", () => {
    const hovered = obs([...HOME_SELECTED.elements, el("Insert (Alt+N)", "tool tip")]);
    expect(isUnchanged(diffScreens(HOME_SELECTED, hovered))).toBe(true);
  });

  it("reports appeared, disappeared, selection and moved controls, and window changes", () => {
    const moved = obs([tab("Home", 0), tab("Insert", 1, true), el("Data", "tab item", { bounds: { x: 300, y: 0, width: 40, height: 20 } })]);
    const change = diffScreens(INSERT_SELECTED, { ...moved, windowTitle: "Book2 - Excel" });
    expect(change).toMatchObject({
      windowChanged: true,
      appeared: [],
      disappeared: [{ role: "button", name: "PivotTable" }],
      selected: [],
      deselected: [],
      moved: [{ role: "tab item", name: "Data" }],
    });
    expect(diffScreens(HOME_SELECTED, INSERT_SELECTED)).toMatchObject({
      appeared: [{ role: "button", name: "PivotTable" }],
      selected: [{ role: "tab item", name: "Insert" }],
      deselected: [{ role: "tab item", name: "Home" }],
    });
  });

  it("pairs repeated controls one to one, so a second copy appearing is noticed", () => {
    const one = obs([el("Item", "text")]);
    const two = obs([el("Item", "text"), el("Item", "text", { bounds: { x: 0, y: 100, width: 40, height: 20 } })]);
    expect(diffScreens(one, two).appeared).toEqual([{ role: "text", name: "Item" }]);
  });
});

describe("assessAction", () => {
  it("an unchanged screen with no click on a control is nothing to react to", () => {
    expect(assessAction({ before: HOME_SELECTED, after: later(HOME_SELECTED) }, STEP)).toBe("unchanged");
    // A click in empty space or on a container (the sheet itself) is not an attempt at another control.
    const pane = obs([...HOME_SELECTED.elements, el("Sheet", "pane", { bounds: { x: 0, y: 100, width: 800, height: 600 } })]);
    expect(assessAction({ before: pane, after: later(pane, { inputs: click(400, 400) }) }, STEP)).toBe("unchanged");
  });

  it("small changes unrelated to the step are noise", () => {
    const status = obs([...HOME_SELECTED.elements, el("Average: 4", "text", { bounds: { x: 0, y: 700, width: 80, height: 20 } })]);
    expect(assessAction({ before: HOME_SELECTED, after: status }, STEP)).toBe("noise");
  });

  it("a click on another control is off track even when nothing changed", () => {
    expect(assessAction({ before: HOME_SELECTED, after: later(HOME_SELECTED, { inputs: click(20, 10) }) }, STEP)).toBe("off_track");
  });

  it("menus, dialogs, selection changes, many controls changing, undo and another window are off track", () => {
    const menu = obs([...HOME_SELECTED.elements, el("See more", "menu", { bounds: { x: 300, y: 40, width: 120, height: 200 } })]);
    expect(assessAction({ before: HOME_SELECTED, after: menu }, STEP)).toBe("off_track");
    expect(assessAction({ before: menu, after: HOME_SELECTED }, STEP)).toBe("off_track");
    const otherTab = obs([tab("Home", 0), tab("Insert", 1), tab("Data", 2), tab("View", 3, true)]);
    expect(assessAction({ before: obs([...otherTab.elements.slice(0, 3), tab("View", 3)]), after: otherTab }, STEP)).toBe("off_track");
    const ribbon = obs([...HOME_SELECTED.elements, el("A", "button"), el("B", "button"), el("C", "button")]);
    expect(assessAction({ before: HOME_SELECTED, after: ribbon }, STEP)).toBe("off_track");
    expect(assessAction({ before: HOME_SELECTED, after: later(HOME_SELECTED, { inputs: [{ kind: "undo" }] }) }, STEP)).toBe("off_track");
    expect(assessAction({ before: HOME_SELECTED, after: { ...HOME_SELECTED, app: "Code" } }, STEP)).toBe("off_track");
  });

  it("the step's target coming into view or moving is progress; losing it is off track", () => {
    expect(assessAction({ before: HOME_SELECTED, after: INSERT_SELECTED }, PIVOT_STEP)).toBe("progress");
    const shifted = obs(INSERT_SELECTED.elements.map((e) => (e.name === "PivotTable" ? { ...e, bounds: { ...e.bounds, y: 200 } } : e)));
    expect(assessAction({ before: INSERT_SELECTED, after: shifted }, PIVOT_STEP)).toBe("progress");
    expect(assessAction({ before: INSERT_SELECTED, after: HOME_SELECTED }, PIVOT_STEP)).toBe("off_track");
  });

  it("without an earlier screen, assumes the action mattered", () => {
    expect(assessAction({ after: HOME_SELECTED }, STEP)).toBe("off_track");
  });

  it("works for open-ended Hodes with no step", () => {
    expect(assessAction({ before: HOME_SELECTED, after: later(HOME_SELECTED) })).toBe("unchanged");
    expect(assessAction({ before: HOME_SELECTED, after: INSERT_SELECTED })).toBe("off_track");
  });
});

describe("summaries for the reasoner", () => {
  it("describes a change in a few words, newest actions last", () => {
    const text = describeChange(diffScreens(HOME_SELECTED, INSERT_SELECTED));
    expect(text).toContain('selected tab item "Insert"');
    expect(text).toContain('appeared: button "PivotTable"');
    expect(describeChange(diffScreens(HOME_SELECTED, HOME_SELECTED))).toBe("nothing changed");
  });

  it("summarizes the last few actions: what was done, what it hit and what changed", () => {
    const actions = [
      { before: HOME_SELECTED, after: later(HOME_SELECTED, { inputs: click(20, 10) }) },
      { before: HOME_SELECTED, after: later(INSERT_SELECTED, { inputs: click(70, 10) }) },
    ];
    const summary = summarizeActions(actions, STEP);
    expect(summary).toHaveLength(2);
    expect(summary[0]).toMatchObject({ inputs: ["click"], clicked: { role: "tab item", name: "Home" }, verdict: "off_track" });
    expect(summary[1].change.selected).toEqual([{ role: "tab item", name: "Insert" }]);
  });
});
