import { describe, expect, it } from "vitest";
import { TASK_PACKS } from "../../task-packs";
import { evaluateSignal } from "./signals";
import { el, obs } from "./test-fixtures";

/** A ticked box is what a field-list step is about, not which row happens to be highlighted. */

const TICKED = { kind: "element_checked" as const, names: ["Region"] };

describe("element_checked", () => {
  it("is the box's tick when the screen read reports it", () => {
    expect(evaluateSignal(TICKED, obs([el("Region", "tree item", { checked: true, selected: false })]))).toBe(true);
    expect(evaluateSignal(TICKED, obs([el("Region", "tree item", { checked: false, selected: true })]))).toBe(false);
  });

  it("falls back to selection when the read can't tell ticks apart", () => {
    expect(evaluateSignal(TICKED, obs([el("Region", "check box", { selected: true })]))).toBe(true);
    expect(evaluateSignal(TICKED, obs([el("Region", "check box")]))).toBe(false);
  });

  it("is what the PivotTable field steps wait for", () => {
    const pivot = TASK_PACKS.find((pack) => pack.id === "excel-pivot");
    const fields = pivot?.steps.filter((step) => step.id === "add-region" || step.id === "add-sales") ?? [];
    expect(fields.map((step) => step.success.kind)).toEqual(["element_checked", "element_checked"]);
    expect(fields[0].mistakes.map((m) => m.signal.kind)).toEqual(["element_checked"]);
  });
});
