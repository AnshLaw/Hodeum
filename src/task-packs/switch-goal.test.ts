import { describe, expect, it } from "vitest";
import { matchGoal } from "./match";
import { TASK_PACKS } from "./index";

describe("a goal that switches from one mode to another", () => {
  it("is about the mode it switches to, in English, Hinglish and Hindi", () => {
    const goals: [string, string][] = [
      ["switch from dark mode to light mode", "windows-light-mode"],
      ["dark mode se light mode mein badlo", "windows-light-mode"],
      ["light mode se dark mode pe switch karo", "windows-dark-mode"],
      ["लाइट मोड से डार्क मोड में बदलो", "windows-dark-mode"],
      ["डार्क मोड से लाइट मोड में बदलो", "windows-light-mode"],
    ];
    for (const [goal, pack] of goals) expect(matchGoal(goal, TASK_PACKS)?.id, goal).toBe(pack);
  });
});
