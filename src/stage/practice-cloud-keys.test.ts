import { describe, expect, it } from "vitest";
import { NO_KEYS } from "../providers/cloud/keys";
import { PRACTICE_FAILING_KEY, PracticeCloudKeys } from "./practice-cloud-keys";

describe("PracticeCloudKeys", () => {
  it("remembers only that a key was saved, never the key", async () => {
    const keys = new PracticeCloudKeys();
    expect(await keys.refresh()).toEqual(NO_KEYS);
    await keys.save("gemini", "AIza-secret");
    expect(keys.current()).toEqual({ ...NO_KEYS, gemini: true });
    expect(JSON.stringify(keys)).not.toContain("AIza");
    await keys.clear("gemini");
    expect(keys.current()).toEqual(NO_KEYS);
  });

  it("fails on purpose for one key, so the error state can be rehearsed", async () => {
    const keys = new PracticeCloudKeys();
    await expect(keys.save("backboard", PRACTICE_FAILING_KEY)).rejects.toThrow(/practice/);
    expect(keys.current().backboard).toBe(false);
  });
});
