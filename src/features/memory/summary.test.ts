import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../hode/model";
import { INSERT_SELECTED, PACK } from "../hode/test-fixtures";
import { finishedStep, summarize, type StepTrace } from "./summary";

const GUIDING: HodeState = { ...initialState, phase: "guiding", goal: "make a pivot table please", pack: PACK, language: "hinglish" };

const INSERT_DONE: StepTrace = { skill: "excel.navigation.insert_tab", objective: "Open the Insert tab", level: "observe", helped: false, done: true };
const PIVOT_DONE: StepTrace = { skill: "excel.pivot.create", objective: "Click PivotTable", level: "guide", helped: true, done: true };

describe("finishedStep", () => {
  it("traces the step a learner action completed, with its level and whether help was raised", () => {
    const prev = { ...GUIDING, level: "hint" as const, escalated: true };
    const next = { ...prev, stepIndex: 1, phase: "observing" as const };
    expect(finishedStep({ type: "LEARNER_ACTED", observation: INSERT_SELECTED }, prev, next)).toEqual({
      skill: "excel.navigation.insert_tab",
      objective: "Open the Insert tab",
      level: "hint",
      helped: true,
      done: true,
    });
  });

  it("ignores transitions that don't finish a step", () => {
    expect(finishedStep({ type: "LEARNER_ACTED", observation: INSERT_SELECTED }, GUIDING, GUIDING)).toBeUndefined();
    expect(finishedStep({ type: "HINT_REQUESTED" }, GUIDING, { ...GUIDING, escalated: true })).toBeUndefined();
  });
});

describe("summarize", () => {
  it("builds the compact end-of-Hode summary from the traced steps", () => {
    const final = { ...GUIDING, phase: "success" as const, stepIndex: 1 };
    expect(summarize(final, [INSERT_DONE, PIVOT_DONE], "completed")).toEqual({
      hode: "Test",
      completed: true,
      skills_practiced: ["excel.navigation.insert_tab", "excel.pivot.create"],
      needed_help_with: ["Click PivotTable"],
      independent_steps: 1,
      guided_steps: 1,
      preferred_language: "hinglish",
      next_assistance_level: "guide",
    });
  });

  it("counts the step a Hode was ended on as practised, and its help, but not as finished", () => {
    const final = { ...GUIDING, stepIndex: 1, level: "demonstrate" as const, escalated: true };
    expect(summarize(final, [INSERT_DONE], "ended")).toMatchObject({
      completed: false,
      skills_practiced: ["excel.navigation.insert_tab", "excel.pivot.create"],
      needed_help_with: ["Click PivotTable"],
      independent_steps: 1,
      guided_steps: 0,
      next_assistance_level: "demonstrate",
    });
  });

  it("relaxes one step after a Hode done without help", () => {
    const final = { ...GUIDING, phase: "success" as const, stepIndex: 1 };
    const hinted = { ...INSERT_DONE, level: "hint" as const };
    expect(summarize(final, [hinted, { ...PIVOT_DONE, level: "hint", helped: false }], "completed")).toMatchObject({
      needed_help_with: [],
      independent_steps: 0,
      guided_steps: 2,
      next_assistance_level: "observe",
    });
  });

  it("lists each skill once and never carries the learner's own words", () => {
    const twice = { ...PIVOT_DONE, objective: "Confirm the range" };
    const summary = summarize({ ...GUIDING, phase: "success" }, [PIVOT_DONE, twice], "completed");
    expect(summary.skills_practiced).toEqual(["excel.pivot.create"]);
    expect(JSON.stringify(summary)).not.toContain(GUIDING.goal);
  });

  it("keeps an open Hode's level when no step was traced", () => {
    const open = { ...initialState, phase: "success" as const, goal: "set margins", open: true, level: "hint" as const };
    expect(summarize(open, [], "completed")).toMatchObject({ hode: "set margins", skills_practiced: [], next_assistance_level: "hint" });
  });
});
