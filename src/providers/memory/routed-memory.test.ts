import { describe, expect, it, vi } from "vitest";
import type { HodeLearningSummary, LearningMemory, MemoryProvider } from "../interfaces";
import { CLOUD_RECALL_WAIT_MS, RoutedMemory } from "./routed-memory";

const SUMMARY: HodeLearningSummary = {
  hode: "Zip files",
  completed: true,
  skills_practiced: ["windows.files.zip"],
  needed_help_with: [],
  independent_steps: 2,
  guided_steps: 0,
  preferred_language: "en",
  next_assistance_level: "observe",
};
const QUERY = { goal: "Zip files", skillIds: ["windows.files.zip"] };

function fake(recalled: LearningMemory[], order: string[], name: string): MemoryProvider {
  return {
    getRelevantMemory: vi.fn(async () => recalled),
    storeLearningSummary: vi.fn(async () => {
      order.push(name);
    }),
    healthCheck: async () => true,
  };
}

describe("RoutedMemory", () => {
  it("writes SQLite first, then the cloud", async () => {
    const order: string[] = [];
    await new RoutedMemory(fake([], order, "local"), fake([], order, "cloud")).storeLearningSummary(SUMMARY);
    expect(order).toEqual(["local", "cloud"]);
  });

  it("logs a failed write and still tries the other store", async () => {
    const order: string[] = [];
    const local = fake([], order, "local");
    const cloud = fake([], order, "cloud");
    vi.mocked(local.storeLearningSummary).mockRejectedValueOnce(new Error("disk"));
    vi.mocked(cloud.storeLearningSummary).mockRejectedValueOnce(new Error("offline"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await new RoutedMemory(local, cloud).storeLearningSummary(SUMMARY);
    expect(cloud.storeLearningSummary).toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("recalls local memories first, then cloud notes", async () => {
    const local = fake([{ skillId: "windows.files.zip", note: "local", level: "observe" }], [], "local");
    const cloud = fake([{ skillId: "windows.files.zip", note: "cloud" }], [], "cloud");
    expect((await new RoutedMemory(local, cloud).getRelevantMemory(QUERY)).map((m) => m.note)).toEqual(["local", "cloud"]);
  });

  it("doesn't wait on a slow or failing cloud to recall locally", async () => {
    vi.useFakeTimers();
    const local = fake([{ skillId: "windows.files.zip", note: "local" }], [], "local");
    const cloud = fake([], [], "cloud");
    vi.mocked(cloud.getRelevantMemory).mockReturnValueOnce(new Promise(() => undefined));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recalled = new RoutedMemory(local, cloud).getRelevantMemory(QUERY);
    await vi.advanceTimersByTimeAsync(CLOUD_RECALL_WAIT_MS);
    expect((await recalled).map((m) => m.note)).toEqual(["local"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    vi.useRealTimers();
  });

  it("works with no cloud provider", async () => {
    const local = fake([], [], "local");
    const memory = new RoutedMemory(local);
    await memory.storeLearningSummary(SUMMARY);
    expect(await memory.getRelevantMemory(QUERY)).toEqual([]);
    expect(await memory.healthCheck()).toBe(true);
  });
});
