import { describe, expect, it, vi } from "vitest";
import { MemoryKeyValueStore } from "../../data/kv";
import { DEFAULT_SETTINGS, type CloudSettings, type MemoryMode } from "../../data/settings";
import { CloudPolicy } from "../cloud/policy";
import type { HodeLearningSummary } from "../interfaces";
import { ASSISTANT_ID_KEY, BackboardMemoryProvider, summaryMessage } from "./backboard-memory";

const SUMMARY: HodeLearningSummary = {
  hode: "Make a PivotTable",
  completed: true,
  skills_practiced: ["excel.pivot.create"],
  needed_help_with: ["Confirm the range and click OK"],
  independent_steps: 3,
  guided_steps: 2,
  preferred_language: "en",
  next_assistance_level: "hint",
};
const QUERY = { goal: "Make a PivotTable", skillIds: ["excel.pivot.create", "excel.pivot.fields"] };

function setup(memory: MemoryMode, options: { key?: boolean; app?: string; assistant?: string } = {}) {
  const cloud: CloudSettings = { ...DEFAULT_SETTINGS.cloud, memory };
  const policy = new CloudPolicy({
    settings: () => cloud,
    keys: () => ({ gemini: false, elevenlabs: false, backboard: options.key ?? true }),
    activeApp: () => (options.app ? { app: options.app, windowTitle: "" } : undefined),
  });
  const kv = new MemoryKeyValueStore();
  if (options.assistant) kv.set(ASSISTANT_ID_KEY, options.assistant);
  const invoke = vi.fn(async (command: string): Promise<unknown> => {
    if (command === "backboard_create_assistant") return "asst-1";
    if (command === "backboard_create_thread") return "thread-1";
    if (command === "backboard_search_memories") return [{ content: "Needed help with excel.pivot.create range selection" }, { content: "Prefers short answers" }];
    return undefined;
  });
  const provider = new BackboardMemoryProvider({ invoke: invoke as never, policy, kv });
  return { provider, invoke, policy, kv };
}

const commands = (invoke: ReturnType<typeof vi.fn>) => invoke.mock.calls.map(([command]) => command);

describe("BackboardMemoryProvider", () => {
  it("does nothing while memory is off, the key is missing, or a sensitive app is in front", async () => {
    for (const h of [setup("off"), setup("auto", { key: false }), setup("auto", { app: "1Password" })]) {
      await h.provider.storeLearningSummary(SUMMARY);
      expect(await h.provider.getRelevantMemory(QUERY)).toEqual([]);
      expect(h.invoke).not.toHaveBeenCalled();
    }
  });

  it("in auto, creates one assistant per Hodian and one thread per Hode, and sends only the summary", async () => {
    const h = setup("auto");
    await h.provider.storeLearningSummary(SUMMARY);
    await h.provider.storeLearningSummary(SUMMARY);
    expect(commands(h.invoke)).toEqual(["backboard_create_assistant", "backboard_create_thread", "backboard_add_message", "backboard_create_thread", "backboard_add_message"]);
    expect(await h.kv.get(ASSISTANT_ID_KEY)).toBe("asst-1");
    expect(h.invoke).toHaveBeenCalledWith("backboard_create_thread", { assistantId: "asst-1" });
    expect(h.invoke).toHaveBeenCalledWith("backboard_add_message", { threadId: "thread-1", content: summaryMessage(SUMMARY), memory: "Auto" });
  });

  it("in readonly, recalls but never writes", async () => {
    const h = setup("readonly", { assistant: "asst-9" });
    await h.provider.storeLearningSummary(SUMMARY);
    const recalled = await h.provider.getRelevantMemory(QUERY);
    expect(commands(h.invoke)).toEqual(["backboard_search_memories"]);
    expect(h.invoke).toHaveBeenCalledWith("backboard_search_memories", expect.objectContaining({ assistantId: "asst-9" }));
    expect(recalled).toEqual([
      { skillId: "excel.pivot.create", note: "Needed help with excel.pivot.create range selection" },
      { skillId: "", note: "Prefers short answers" },
    ]);
  });

  it("recalls nothing before an assistant exists", async () => {
    const h = setup("auto");
    expect(await h.provider.getRelevantMemory(QUERY)).toEqual([]);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("keeps an open Hode's goal (the learner's own words) local", async () => {
    const h = setup("auto");
    await h.provider.storeLearningSummary({ ...SUMMARY, hode: "help me fix my payslip", skills_practiced: [] });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("reports a failure to the policy, so the next request skips Backboard for the cooldown", async () => {
    const h = setup("auto", { assistant: "asst-1" });
    h.invoke.mockRejectedValueOnce(new Error("offline"));
    await expect(h.provider.storeLearningSummary(SUMMARY)).rejects.toThrow("offline");
    expect(h.policy.allowed("backboard")).toBe(false);
    expect(await h.provider.getRelevantMemory(QUERY)).toEqual([]);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("puts the summary as compact JSON in the message, with no transcript", () => {
    const message = summaryMessage(SUMMARY);
    expect(message).toContain(JSON.stringify(SUMMARY));
    expect(message.length).toBeLessThan(600);
  });
});
