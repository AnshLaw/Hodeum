import { describe, expect, it } from "vitest";
import type { TaskPack, TaskStep, TeachingContext, UiElement } from "../lib/types";
import { el, obs, tab } from "../features/hode/test-fixtures";
import { initialState } from "../features/hode/model";
import { step as reduce } from "../features/hode/reducer";
import { evaluateSignal } from "../features/hode/signals";
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
