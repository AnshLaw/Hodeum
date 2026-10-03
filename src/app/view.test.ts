import { describe, expect, it } from "vitest";
import { skillRecord } from "../features/hode/test-fixtures";
import { TASK_PACKS } from "../task-packs";
import { durationLabel, isLiveHode, outcomeOf, skillTitle, suggestedPacks, timeAgo } from "./view";

const now = new Date("2026-10-03T12:00:00Z");

describe("app view helpers", () => {
  it("formats relative times", () => {
    expect(timeAgo("2026-10-03T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-03T11:15:00Z", now)).toBe("45 min ago");
    expect(timeAgo("2026-10-03T07:00:00Z", now)).toBe("5 h ago");
    expect(timeAgo("2026-10-02T10:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-09-30T10:00:00Z", now)).toBe("3 days ago");
  });

  it("labels outcomes and durations", () => {
    const hode = { id: "1", goal: "g", open: false, startedAt: "2026-10-03T11:00:00Z" };
    expect(outcomeOf(hode)).toEqual({ label: "In progress", tone: "live" });
    expect(durationLabel({ ...hode, endedAt: "2026-10-03T11:07:00Z", outcome: "completed" })).toBe("7 min");
    expect(durationLabel({ ...hode, endedAt: "2026-10-03T11:00:20Z", outcome: "completed" })).toBe("< 1 min");
  });

  it("only treats a running Hode as live, not goal entry or the success beat", () => {
    const summary = { goal: "g", title: "t" };
    expect(isLiveHode({ ...summary, phase: "guiding" })).toBe(true);
    expect(isLiveHode({ ...summary, phase: "paused" })).toBe(true);
    expect(isLiveHode({ ...summary, phase: "goal_entry" })).toBe(false);
    expect(isLiveHode({ ...summary, phase: "success" })).toBe(false);
    expect(isLiveHode({ phase: "annotating", goal: "", title: "" })).toBe(false);
  });

  it("suggests untried packs first and hides mastered ones", () => {
    const [excel, zip] = TASK_PACKS;
    const mastered = zip.steps.map((s) => ({ ...skillRecord("independent", s.skill), status: "mastered" as const }));
    expect(suggestedPacks(TASK_PACKS, mastered).map((p) => p.id)).toEqual([excel.id]);
    expect(suggestedPacks(TASK_PACKS, []).map((p) => p.id)).toEqual([excel.id, zip.id]);
  });

  it("titles skills within their app", () => {
    expect(skillTitle("excel.navigation.insert_tab")).toBe("Navigation › Insert tab");
  });
});
