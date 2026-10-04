import { describe, expect, it } from "vitest";
import { padRect } from "../../lib/coords";
import type { Rect } from "../../lib/types";
import { REGION_PADDING_PX, regionAround } from "./region";
import { el, tab } from "./test-fixtures";

const box = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe("regionAround: where a hint points", () => {
  it("is the row of tabs the target sits in", () => {
    const tabs = [tab("Home", 0), tab("Insert", 1), tab("Data", 2)];
    expect(regionAround(tabs[1], tabs)).toEqual(padRect(box(0, 0, 140, 20), REGION_PADDING_PX));
  });

  it("is the column of a list, even when the items differ in width", () => {
    const fields = ["Region", "Product", "Sales"].map((name, i) => el(name, "check box", { id: `field:${name}`, bounds: box(300, 100 + i * 24, 60 + i * 10, 20) }));
    expect(regionAround(fields[0], fields)).toEqual(padRect(box(300, 100, 80, 68), REGION_PADDING_PX));
  });

  it("leaves out look-alikes far away, and controls of another kind", () => {
    const tabs = [tab("Home", 0), tab("Insert", 1), tab("Data", 2)];
    const farTab = el("Sheet2", "tab item", { id: "tab:Sheet2", bounds: box(0, 900, 40, 20) });
    const farRight = el("Help", "tab item", { id: "tab:Help", bounds: box(900, 0, 40, 20) });
    const button = el("Bold", "button", { bounds: box(150, 0, 20, 20) });
    expect(regionAround(tabs[1], [...tabs, farTab, farRight, button])).toEqual(padRect(box(0, 0, 140, 20), REGION_PADDING_PX));
  });

  it("groups controls of one family: Excel's PivotTable split button sits among plain buttons", () => {
    const ribbon = [
      el("PivotTable", "split button", { bounds: box(0, 40, 50, 60) }),
      el("Recommended PivotTables", "button", { bounds: box(54, 40, 50, 60) }),
      el("Table", "button", { bounds: box(108, 40, 50, 60) }),
      el("Bold", "check box", { bounds: box(162, 40, 50, 60) }),
    ];
    expect(regionAround(ribbon[0], ribbon)).toEqual(padRect(box(0, 40, 158, 60), REGION_PADDING_PX));
  });

  it("is nothing for a control that stands alone: lighting it up would give the answer away", () => {
    const ok = el("OK", "button", { bounds: box(200, 200, 60, 24) });
    const cancel = el("Cancel", "button", { bounds: box(270, 200, 60, 24) });
    expect(regionAround(ok, [ok])).toBeUndefined();
    expect(regionAround(ok, [ok, cancel])).toBeUndefined();
  });

  it("is nothing when the area would cover most of the window", () => {
    const tabs = [tab("Home", 0), tab("Insert", 1), tab("Data", 2)];
    expect(regionAround(tabs[1], tabs, box(0, 0, 150, 30))).toBeUndefined();
    expect(regionAround(tabs[1], tabs, box(0, 0, 1920, 1080))).toBeDefined();
  });
});
