import { describe, expect, it } from "vitest";
import { testDatabase } from "../../data/test-sql";
import type { HodeLearningSummary, MemoryProvider } from "../interfaces";
import { LocalMemoryProvider, MAX_RECALLED_MEMORIES, SqliteMemoryProvider } from "./sqlite-memory";

const PIVOT: HodeLearningSummary = {
  hode: "Make a PivotTable",
  completed: true,
  skills_practiced: ["excel.navigation.insert_tab", "excel.pivot.create"],
  needed_help_with: ["Confirm the range and click OK"],
  independent_steps: 3,
  guided_steps: 2,
  preferred_language: "en",
  next_assistance_level: "hint",
};
const ZIP: HodeLearningSummary = { ...PIVOT, hode: "Zip files", skills_practiced: ["windows.files.zip"], needed_help_with: [], next_assistance_level: "observe" };

function clock() {
  let minute = 0;
  return () => `2026-10-03T10:${String(minute++).padStart(2, "0")}:00.000Z`;
}

const providers: [string, () => MemoryProvider][] = [
  ["sqlite", () => new SqliteMemoryProvider(testDatabase(), clock())],
  ["local", () => new LocalMemoryProvider(clock())],
];

describe.each(providers)("%s memory provider", (_, make) => {
  it("recalls summaries that share a skill, newest first, with their next level", async () => {
    const memory = make();
    await memory.storeLearningSummary(PIVOT);
    await memory.storeLearningSummary(ZIP);
    await memory.storeLearningSummary({ ...PIVOT, completed: false, next_assistance_level: "guide" });
    const recalled = await memory.getRelevantMemory({ goal: "Something else", skillIds: ["excel.pivot.create"] });
    expect(recalled.map((m) => [m.skillId, m.level])).toEqual([
      ["excel.pivot.create", "guide"],
      ["excel.pivot.create", "hint"],
    ]);
    expect(recalled[1].note).toContain("Confirm the range and click OK");
  });

  it("recalls every skill of a summary for the same goal", async () => {
    const memory = make();
    await memory.storeLearningSummary(PIVOT);
    const recalled = await memory.getRelevantMemory({ goal: "make a pivottable", skillIds: [] });
    expect(recalled.map((m) => m.skillId)).toEqual(PIVOT.skills_practiced);
  });

  it("caps what it recalls", async () => {
    const memory = make();
    for (let i = 0; i < MAX_RECALLED_MEMORIES + 2; i++) await memory.storeLearningSummary(PIVOT);
    const recalled = await memory.getRelevantMemory({ goal: "", skillIds: ["excel.pivot.create"] });
    expect(recalled).toHaveLength(MAX_RECALLED_MEMORIES);
  });

  it("is healthy", async () => {
    expect(await make().healthCheck()).toBe(true);
  });
});
