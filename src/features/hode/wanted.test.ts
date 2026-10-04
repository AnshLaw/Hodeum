import { describe, expect, it } from "vitest";
import type { TaskPack, TaskStep } from "../../lib/types";
import { TASK_PACKS } from "../../task-packs";
import { initialState, type HodeState } from "./model";
import { PACK } from "./test-fixtures";
import { MAX_WANTED_NAMES, wantedNames } from "./wanted";

function lessonAt(pack: TaskPack, stepId: string): HodeState {
  const stepIndex = pack.steps.findIndex((step) => step.id === stepId);
  if (stepIndex < 0) throw new Error(`${pack.id} has no step ${stepId}`);
  return { ...initialState, phase: "guiding", pack, stepIndex };
}

function pack(id: string): TaskPack {
  const found = TASK_PACKS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No task pack ${id}`);
  return found;
}

function withStep(overrides: Partial<TaskStep>): TaskPack {
  return { ...PACK, steps: [{ ...PACK.steps[0], ...overrides }] };
}

describe("wantedNames", () => {
  it("asks for the step's target and the controls its success signal names", () => {
    expect(wantedNames(lessonAt(pack("notepad-save-note"), "choose-save-as"))).toEqual(["Save as", "File name:"]);
  });

  it("asks only for the target when success is read from the window title", () => {
    expect(wantedNames(lessonAt(pack("notepad-save-note"), "save"))).toEqual(["Save"]);
  });

  it("names a control once, however the step spells it", () => {
    expect(wantedNames(lessonAt(PACK, "open-insert"))).toEqual(["Insert"]);
    expect(wantedNames(lessonAt(withStep({ target: { names: [" Insert ", "INSERT"] } }), "open-insert"))).toEqual(["Insert"]);
    expect(wantedNames(lessonAt(withStep({ target: { names: ["Compress to...", "Compress to…"] } }), "open-insert"))).toEqual(["Compress to...", "Insert"]);
  });

  it("asks for the controls an absent or checked signal waits on too", () => {
    expect(wantedNames(lessonAt(withStep({ success: { kind: "element_absent", names: ["Create PivotTable"] } }), "open-insert"))).toEqual(["Insert", "Create PivotTable"]);
    expect(wantedNames(lessonAt(withStep({ success: { kind: "element_checked", names: ["Region"] } }), "open-insert"))).toEqual(["Insert", "Region"]);
  });

  it("never asks for a pattern, which only the whole read can match", () => {
    expect(wantedNames(lessonAt(pack("calculator-percent"), "percent"))).toEqual(["Percent", "Display is 0.2"]);
    expect(wantedNames(lessonAt(pack("windows-zip"), "choose-zip"))).toEqual(["ZIP File", "Compressed (zipped) Folder"]);
  });

  it("asks for at most the cap, the target's names first", () => {
    const targets = Array.from({ length: MAX_WANTED_NAMES + 2 }, (_, i) => `Control ${i}`);
    const wanted = wantedNames(lessonAt(withStep({ target: { names: targets } }), "open-insert"));
    expect(wanted).toEqual(targets.slice(0, MAX_WANTED_NAMES));
  });

  it("asks for nothing outside a lesson's steps", () => {
    expect(wantedNames(initialState)).toEqual([]);
    expect(wantedNames({ ...initialState, phase: "observing", open: true, goal: "rename a layer" })).toEqual([]);
    expect(wantedNames({ ...initialState, phase: "success", pack: PACK, stepIndex: PACK.steps.length })).toEqual([]);
  });
});
