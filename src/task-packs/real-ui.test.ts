import { describe, expect, it } from "vitest";
import type { TaskPack, TaskStep, TeachingContext, UiElement } from "../lib/types";
import { el, obs, tab } from "../features/hode/test-fixtures";
import { initialState } from "../features/hode/model";
import { step as reduce } from "../features/hode/reducer";
import { becameTrue, evaluateSignal } from "../features/hode/signals";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { TASK_PACKS } from "./index";

/**
 * The demo packs against the names and roles real Windows 11 and Microsoft 365 report through UI
 * Automation, which differ from the practice scenes: PivotTable is a split button, the field list's
 * boxes can be tree items, and File Explorer hides known extensions.
 */

const pack = (id: string): TaskPack => {
  const found = TASK_PACKS.find((p) => p.id === id);
  if (!found) throw new Error(`no pack ${id}`);
  return found;
};
const stepOf = (packId: string, stepId: string): TaskStep => {
  const found = pack(packId).steps.find((s) => s.id === stepId);
  if (!found) throw new Error(`no step ${stepId}`);
  return found;
};

const planner = new TaskPackReasoningProvider();
const guide = (packId: string, stepId: string, elements: UiElement[]) => {
  const context: TeachingContext = { goal: "demo", pack: pack(packId), step: stepOf(packId, stepId), observation: obs(elements), assistanceLevel: "guide", recentMistakes: 0 };
  return planner.reason(context);
};

describe("Excel PivotTable on Microsoft 365", () => {
  it("points at PivotTable with full confidence when Excel reports it as a split button", async () => {
    const action = await guide("excel-pivot", "click-pivot", [tab("Insert", 1, true), el("PivotTable", "split button")]);
    expect(action.kind).toBe("guide");
    expect(action.target?.confidence).toBe(0.95);
  });

  it("points at a field whose box is a tree item", async () => {
    const action = await guide("excel-pivot", "add-region", [el("Region", "tree item"), el("Sales", "tree item")]);
    expect(action.target).toMatchObject({ label: "Region", confidence: 0.95 });
  });

  it("knows the PivotTable was made when the field list or its Analyze tab shows", () => {
    const made = stepOf("excel-pivot", "confirm-range").success;
    expect(evaluateSignal(made, obs([el("PivotTable Analyze", "tab item")]))).toBe(true);
    expect(evaluateSignal(made, obs([el("PivotTable Fields", "pane")]))).toBe(true);
  });
});

describe("zipping in File Explorer", () => {
  it("knows the zip was made when the new item shows as a compressed folder, extensions hidden", () => {
    const made = stepOf("windows-zip", "choose-zip").success;
    expect(evaluateSignal(made, obs([el("report", "list item"), el("Compressed (zipped) Folder", "text")]))).toBe(true);
    expect(evaluateSignal(made, obs([el("report.zip", "list item")]))).toBe(true);
  });

  it("accepts the menu as Windows 11 labels it", async () => {
    const action = await guide("windows-zip", "choose-compress", [el("Compress to", "menu item")]);
    expect(action.kind).toBe("guide");
  });
});

describe("the practice file", () => {
  it("opens with the lesson in every mode, so a learner without the sales workbook can still do it", () => {
    for (const mode of ["teach", "help", "agent"] as const) {
      const begun = reduce(reduce(initialState, { type: "START_HODE" }).state, { type: "GOAL_SUBMITTED", goal: "make a pivot table", pack: pack("excel-pivot"), mode });
      expect(begun.effects[0]).toEqual({ type: "focusApp", app: "Excel", launch: pack("excel-pivot").launch });
    }
  });
});

/** Settings > Personalization > Colors as Windows 11 25H2 reports it (native UIA dump, this PC). */
const MODE_BOX = el("Choose your mode", "combo box");
const modeClosed = (current: string) => obs([el("Choose your mode", "group"), el("Choose your mode", "text"), MODE_BOX, el(current, "list item", { selected: true }), el("Transparency effects", "toggle switch")]);
const modeOpen = (current: string) => obs([MODE_BOX, ...["Light", "Dark", "Custom"].map((mode) => el(mode, "list item", { selected: mode === current })), el("Close", "button")]);

describe("Light and Dark mode in Settings", () => {
  it.each([
    ["windows-light-mode", "Dark", "Light"],
    ["windows-dark-mode", "Light", "Dark"],
  ])("%s: opens the mode box, then picks the other mode", async (id, from, to) => {
    const box = await guide(id, "open-mode-menu", modeClosed(from).elements);
    expect(box.target).toMatchObject({ elementId: MODE_BOX.id, confidence: 0.95 });
    const opened = stepOf(id, "open-mode-menu").success;
    expect(evaluateSignal(opened, modeClosed(from))).toBe(false);
    expect(evaluateSignal(opened, modeOpen(from))).toBe(true);

    const choose = stepOf(id, `choose-${to.toLowerCase()}`);
    expect((await guide(id, choose.id, modeOpen(from).elements)).target).toMatchObject({ elementId: `list item:${to}`, confidence: 0.95 });
    expect(evaluateSignal(choose.success, modeOpen(from))).toBe(false);
    expect(evaluateSignal(choose.success, modeClosed(to))).toBe(true);
  });

  it("corrects a learner who picks Custom", () => {
    const choose = stepOf("windows-light-mode", "choose-light");
    expect(choose.mistakes.some((m) => evaluateSignal(m.signal, modeClosed("Custom")))).toBe(true);
    expect(choose.mistakes.some((m) => evaluateSignal(m.signal, modeOpen("Dark")))).toBe(false);
  });

  it("is opened on the Colors page in every mode", () => {
    for (const mode of ["teach", "help", "agent"] as const) {
      const begun = reduce(reduce(initialState, { type: "START_HODE" }).state, { type: "GOAL_SUBMITTED", goal: "turn on light mode", pack: pack("windows-light-mode"), mode });
      expect(begun.effects[0]).toEqual({ type: "focusApp", app: "Settings", launch: { uri: "ms-settings:colors" } });
    }
  });
});

/** Notepad 11.2607 window titles and Save as dialog names (native UIA dump, this PC). */
const notepad = (windowTitle: string, elements: UiElement[] = []): ReturnType<typeof obs> => ({ ...obs(elements), app: "Notepad", windowTitle });

describe("writing and saving a note in Notepad", () => {
  it("follows the title from the restored tab, to a new tab, to typed text, to the saved file", () => {
    const [newTab, typed, , , saved] = pack("notepad-save-note").steps.map((s) => s.success);
    expect(evaluateSignal(newTab, notepad("Hodeum note.txt - Notepad"))).toBe(false);
    expect(evaluateSignal(newTab, notepad("Untitled - Notepad"))).toBe(true);
    expect(evaluateSignal(typed, notepad("Untitled - Notepad"))).toBe(false);
    expect(evaluateSignal(typed, notepad("*Buy milk - Notepad"))).toBe(true);
    expect(evaluateSignal(saved, notepad("Save as", [el("File name:", "edit")]))).toBe(false);
    expect(evaluateSignal(saved, notepad("Buy milk.txt - Notepad"))).toBe(true);
  });

  it("points at the dialog's Save button, not the File menu's Save", async () => {
    const dialog = [el("Save as", "dialog"), el("File name:", "edit"), el("Save", "button"), el("Cancel", "button"), el("Address: Documents", "tool bar")];
    const action = await guide("notepad-save-note", "save", [el("Save", "menu item"), ...dialog]);
    expect(action.target).toMatchObject({ elementId: "button:Save", confidence: 0.95 });
  });

  it("sees the Save as window open from the File menu", () => {
    const menu = stepOf("notepad-save-note", "open-file-menu").success;
    expect(evaluateSignal(menu, notepad("*Buy milk - Notepad", [el("File", "menu item"), el("Save", "menu item"), el("Save as", "menu item")]))).toBe(true);
    expect(evaluateSignal(stepOf("notepad-save-note", "choose-save-as").success, notepad("Save as", [el("File name:", "edit")]))).toBe(true);
  });

  it("notices Cancel closed the Save as window", () => {
    const [cancelled] = stepOf("notepad-save-note", "save").mistakes;
    expect(becameTrue(cancelled.signal, notepad("Save as", [el("Save", "button")]), notepad("*Buy milk - Notepad", [el("Add New Tab", "button")]))).toBe(true);
  });
});

/** Calculator 11.2607 Standard mode names (native UIA dump, this PC); the × is U+00D7. */
const calc = (...texts: string[]): ReturnType<typeof obs> => ({ ...obs(texts.map((t) => el(t, "text"))), app: "Calculator", windowTitle: "Calculator" });

describe("20% of 50 in Calculator", () => {
  const success = (stepId: string) => stepOf("calculator-percent", stepId).success;
  const mistakes = (stepId: string) => stepOf("calculator-percent", stepId).mistakes.map((m) => m.signal);

  it("switches a Scientific calculator to Standard", () => {
    expect(evaluateSignal(success("open-menu"), calc("Scientific Calculator mode"))).toBe(false);
    expect(evaluateSignal(success("open-menu"), { ...calc("Scientific Calculator mode"), elements: [el("Standard Calculator", "list item")] })).toBe(true);
    expect(evaluateSignal(success("choose-standard"), calc("Scientific Calculator mode"))).toBe(false);
    expect(evaluateSignal(success("choose-standard"), calc("Standard Calculator mode"))).toBe(true);
  });

  it("reads each key from the display, as Calculator announces it", () => {
    expect(evaluateSignal(success("type-fifty"), calc("Display is 5"))).toBe(false);
    expect(evaluateSignal(success("type-fifty"), calc("Display is 50"))).toBe(true);
    expect(evaluateSignal(success("multiply"), calc("Expression is 50 ×", "Display is 50"))).toBe(true);
    expect(evaluateSignal(success("type-twenty"), calc("Expression is 50 ×", "Display is 2"))).toBe(false);
    expect(evaluateSignal(success("type-twenty"), calc("Expression is 50 ×", "Display is 20"))).toBe(true);
    expect(evaluateSignal(success("percent"), calc("Expression is 50 × 0.2", "Display is 0.2"))).toBe(true);
    expect(evaluateSignal(success("equals"), calc("Expression is 50 × 0.2=", "Display is 10"))).toBe(true);
  });

  it("corrects plus for times and equals before percent", () => {
    expect(mistakes("multiply").some((m) => evaluateSignal(m, calc("Expression is 50 +", "Display is 50")))).toBe(true);
    expect(mistakes("percent").some((m) => evaluateSignal(m, calc("Expression is 50 × 20=", "Display is 1,000")))).toBe(true);
  });

  it("points at the real keys", async () => {
    const keys = ["Percent", "Clear", "Five", "Zero", "Two", "Multiply by", "Plus", "Equals"].map((name) => el(name, "button"));
    for (const [stepId, name] of [["type-fifty", "Five"], ["multiply", "Multiply by"], ["type-twenty", "Two"], ["percent", "Percent"], ["equals", "Equals"]]) {
      expect((await guide("calculator-percent", stepId, keys)).target?.elementId, stepId).toBe(`button:${name}`);
    }
  });
});
