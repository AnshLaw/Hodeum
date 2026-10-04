import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../../features/hode/model";
import { skillRecord } from "../../features/hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import { graphOf, successProgress } from "./use-skills";

const [excel] = TASK_PACKS;
const finished: HodeState = { ...initialState, phase: "success", pack: excel, learnedSkills: ["excel.navigation.insert_tab"] };

describe("successProgress", () => {
  it("only appears on the success card, once skills have loaded", () => {
    const ready = { state: "ready" as const, records: [] };
    expect(successProgress({ ...finished, phase: "guiding" }, [], ready, TASK_PACKS)).toBeUndefined();
    expect(successProgress(finished, [], { state: "loading" }, TASK_PACKS)).toBeUndefined();
  });

  it("shows what moved since the Hode started and what to practise next", () => {
    const after = [skillRecord("hint", "excel.navigation.insert_tab")];
    const progress = successProgress(finished, [], { state: "ready", records: after }, TASK_PACKS);
    expect(progress?.changes.map((c) => [c.fromLabel, c.toLabel])).toEqual([["New", "Learning"]]);
    expect(progress?.next?.pack.id).not.toBe(excel.id);
  });

  it("shows no change rather than a made-up one without a start snapshot", () => {
    const after = [skillRecord("hint", "excel.navigation.insert_tab")];
    const [change] = successProgress(finished, undefined, { state: "ready", records: after }, TASK_PACKS)?.changes ?? [];
    expect(change.from).toBe(change.to);
  });
});

describe("graphOf", () => {
  it("passes loading and errors through, and builds the graph when ready", () => {
    expect(graphOf({ state: "error", message: "locked" }, TASK_PACKS)).toEqual({ state: "error", message: "locked" });
    const ready = graphOf({ state: "ready", records: [] }, TASK_PACKS);
    expect(ready.state === "ready" && ready.graph.areas.map((a) => a.id)).toEqual(["excel", "windows", "ios", "settings", "notepad", "calculator"]);
  });
});
