import { describe, expect, it } from "vitest";
import { TASK_PACKS, matchGoal } from ".";

/** Speech recognition writes "fifteen percent" as "15%": the sign names the task as the word does. */
describe("a percent sign in a goal", () => {
  it.each(["what is 15% of 200", "What's 15% of 200?", "calculate 20% of 50"])("finds the percentage lesson for %s", (goal) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe("calculator-percent");
  });

  it("still finds it spelled out", () => {
    expect(matchGoal("what is 15 percent of 200", TASK_PACKS)?.id).toBe("calculator-percent");
  });
});
