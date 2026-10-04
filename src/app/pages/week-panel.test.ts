import { describe, expect, it } from "vitest";
import type { DayActivity } from "../../data/stats";
import { weekSentence } from "./WeekPanel";

const day = (minutes: number, hodes: number, completed: number): DayActivity => ({ date: new Date(2026, 9, 3), minutes, hodes, completed, today: false });

describe("weekSentence", () => {
  it("invites a first Hode on an empty week", () => {
    expect(weekSentence([day(0, 0, 0)], 0, 0)).toBe("No Hodes this week yet. Pick one below and Hodey will walk you through it.");
  });

  it("says the week the way a learner would", () => {
    expect(weekSentence([day(30, 2, 1), day(12, 1, 1)], 3, 2)).toBe("This week you spent 42 minutes in 3 Hodes and finished 2. You're on a 3-day streak, 2 skills mastered so far.");
  });

  it("is honest about a week of unfinished Hodes", () => {
    expect(weekSentence([day(1, 1, 0)], 1, 0)).toBe("This week you spent 1 minute in 1 Hode and haven't finished one yet.");
  });
});
