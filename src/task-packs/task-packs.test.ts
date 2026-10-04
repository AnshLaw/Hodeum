import { describe, expect, it } from "vitest";
import excelPivot from "./excel-pivot.json";
import { TASK_PACKS, appFromGoal, matchGoal } from "./index";
import { loadTaskPack } from "./schema";

type RawPack = { steps: Array<{ skill: string; target: Record<string, unknown> }> };
const clone = (): RawPack => JSON.parse(JSON.stringify(excelPivot)) as RawPack;

describe("loadTaskPack", () => {
  it("loads every shipped pack", () => {
    expect(TASK_PACKS.map((p) => p.id)).toEqual(["excel-pivot", "windows-zip", "iphone-dark-mode"]);
  });

  it("rejects coordinates in a target", () => {
    const raw = clone();
    raw.steps[0].target.bbox = [1, 2, 3, 4];
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("accepts a target that prefers a selected item, and nothing else there", () => {
    const raw = clone();
    raw.steps[0].target.prefer = "selected";
    expect(loadTaskPack(raw).steps[0].target.prefer).toBe("selected");
    raw.steps[0].target.prefer = "biggest";
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("the Zip pack's first step points at a selected file, not the whole list", () => {
    const zip = TASK_PACKS.find((p) => p.id === "windows-zip");
    expect(zip?.steps[0].target.prefer).toBe("selected");
  });

  it("rejects a pack without steps", () => {
    const raw = clone();
    raw.steps = [];
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("accepts a phone surface and a screen_tone signal", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown> & { steps: Array<Record<string, unknown>> };
    raw.surface = "phone";
    raw.steps[0].success = { kind: "screen_tone", tone: "dark" };
    expect(loadTaskPack(raw).surface).toBe("phone");
  });

  it("rejects an unknown surface", () => {
    const raw = JSON.parse(JSON.stringify(excelPivot)) as Record<string, unknown>;
    raw.surface = "android";
    expect(() => loadTaskPack(raw)).toThrow(/Invalid task pack/);
  });

  it("rejects a malformed skill id", () => {
    const raw = clone();
    raw.steps[0].skill = "Excel Insert";
    expect(() => loadTaskPack(raw)).toThrow(/skill ids/);
  });
});

describe("matchGoal", () => {
  it.each([
    ["Teach me how to make a pivot table in Excel", "excel-pivot"],
    ["mujhe pivot table banana sikhao", "excel-pivot"],
    ["Make a PivotTable", "excel-pivot"],
    ["zip these files", "windows-zip"],
    ["how do I compress my photos", "windows-zip"],
    ["turn on dark mode on my iphone", "iphone-dark-mode"],
    ["make my phone dark mode", "iphone-dark-mode"],
  ])("matches %j to %s", (goal, id) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe(id);
  });

  it.each(["turn on dark mode in windows", "enable dark mode in outlook", "switch excel to dark mode", "dark mode on my laptop"])(
    "keeps the iPhone pack away from the desktop goal %j",
    (goal) => {
      expect(matchGoal(goal, TASK_PACKS)?.id).not.toBe("iphone-dark-mode");
    },
  );

  it("returns undefined for an unrelated goal", () => {
    expect(matchGoal("write a poem", TASK_PACKS)).toBeUndefined();
  });
});

describe("appFromGoal", () => {
  it("finds the app a goal names", () => {
    expect(appFromGoal("add a table of contents in Word")).toBe("Word");
    expect(appFromGoal("how do I make slides in powerpoint")).toBe("PowerPoint");
    expect(appFromGoal("rename a folder in file explorer")).toBe("File Explorer");
    expect(appFromGoal("clear my chrome cache")).toBe("Chrome");
  });

  it("leaves goals without an app alone", () => {
    expect(appFromGoal("teach me keyboard shortcuts")).toBeUndefined();
    expect(appFromGoal("pick the right word for this")).toBeUndefined();
    expect(appFromGoal("open the sidebar in edge")).toBe("Edge");
  });
});
