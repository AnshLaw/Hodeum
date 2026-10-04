import { describe, expect, it } from "vitest";
import type { SkillStore } from "../providers/interfaces";
import { MemoryChatStore, MemoryLearningStore } from "./memory-stores";
import { DEFAULT_SETTINGS, MemorySettingsStore, type SettingsStore } from "./settings";
import { MemoryKeyValueStore, type KeyValueStore } from "./kv";
import { SqliteChatStore, SqliteKeyValueStore, SqliteLearningStore, SqliteSettingsStore } from "./sqlite-stores";
import { testDatabase } from "./test-sql";
import type { ChatStore, LearningStore } from "./types";

const SKILL = "excel.navigation.insert_tab";
const WEB = { query: "excel pivot table", sources: [{ title: "Create a PivotTable", url: "https://support.microsoft.com/pivot" }] };
const OUTCOME = { completed: true, mistakes: 0, level: "guide" as const, escalated: false };

const learningStores: [string, () => LearningStore & SkillStore][] = [
  ["memory", () => new MemoryLearningStore()],
  ["sqlite", () => new SqliteLearningStore(testDatabase())],
];

describe.each(learningStores)("%s learning store", (_, make) => {
  it("keeps Hodes newest first with their events, and ends them", async () => {
    const store = make();
    await store.startHode({ id: "a", goal: "zip files", packId: "zip", open: false, startedAt: "2026-10-01T10:00:00Z" });
    await store.startHode({ id: "b", goal: "margins", open: true, startedAt: "2026-10-02T10:00:00Z" });
    await store.logEvent({ hodeId: "a", kind: "step_done", detail: "Right-click", at: "2026-10-01T10:01:00Z" });
    await store.logEvent({ hodeId: "a", kind: "hint", at: "2026-10-01T10:02:00Z" });
    await store.endHode("a", "completed", "2026-10-01T10:03:00Z");
    expect((await store.listHodes(10)).map((h) => h.id)).toEqual(["b", "a"]);
    expect(await store.listHodes(1)).toEqual([{ id: "b", goal: "margins", open: true, startedAt: "2026-10-02T10:00:00Z" }]);
    expect(await store.getHode("a")).toEqual({
      id: "a",
      goal: "zip files",
      packId: "zip",
      open: false,
      startedAt: "2026-10-01T10:00:00Z",
      endedAt: "2026-10-01T10:03:00Z",
      outcome: "completed",
      events: [
        { hodeId: "a", kind: "step_done", detail: "Right-click", at: "2026-10-01T10:01:00Z" },
        { hodeId: "a", kind: "hint", at: "2026-10-01T10:02:00Z" },
      ],
    });
    expect(await store.getHode("missing")).toBeNull();
  });

  it("records skills and lets the learner change or reset their level", async () => {
    const store = make();
    await store.recordOutcome(SKILL, OUTCOME);
    expect((await store.get(SKILL))?.success_count).toBe(1);
    await store.setSkillLevel(SKILL, "independent");
    expect(await store.listSkills()).toMatchObject([{ skill_id: SKILL, last_assistance_level: "independent", status: "mastered" }]);
    await store.resetSkill(SKILL);
    expect(await store.listSkills()).toEqual([]);
    await expect(store.setSkillLevel("nope", "hint")).rejects.toThrow(/Unknown skill/);
  });
});

const chatStores: [string, () => ChatStore][] = [
  ["memory", () => new MemoryChatStore()],
  ["sqlite", () => new SqliteChatStore(testDatabase())],
];

describe.each(chatStores)("%s chat store", (_, make) => {
  it("lists chats by latest message and deletes them with their messages", async () => {
    const store = make();
    const first = await store.createChat("First", "2026-10-03T10:00:00Z");
    const second = await store.createChat("Second", "2026-10-03T10:05:00Z");
    await store.append({ id: "m1", chatId: first.id, role: "user", content: "hi", context: "Sales.xlsx - Excel", at: "2026-10-03T10:10:00Z" });
    await store.append({ id: "m2", chatId: first.id, role: "hodey", content: "hello", web: WEB, at: "2026-10-03T10:10:05Z" });
    expect((await store.listChats()).map((c) => c.title)).toEqual(["First", "Second"]);
    expect(await store.messages(first.id)).toEqual([
      { id: "m1", chatId: first.id, role: "user", content: "hi", context: "Sales.xlsx - Excel", at: "2026-10-03T10:10:00Z" },
      { id: "m2", chatId: first.id, role: "hodey", content: "hello", web: WEB, at: "2026-10-03T10:10:05Z" },
    ]);
    await store.deleteChat(first.id);
    expect((await store.listChats()).map((c) => c.id)).toEqual([second.id]);
    expect(await store.messages(first.id)).toEqual([]);
  });
});

const settingsStores: [string, () => SettingsStore][] = [
  ["memory", () => new MemorySettingsStore()],
  ["sqlite", () => new SqliteSettingsStore(testDatabase())],
];

describe.each(settingsStores)("%s settings store", (_, make) => {
  it("starts from defaults and round-trips changes", async () => {
    const store = make();
    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
    const next = { ...DEFAULT_SETTINGS, mode: "help" as const, stuckSeconds: 20 };
    await store.save(next);
    expect(await store.load()).toEqual(next);
  });
});

const keyValueStores: [string, () => KeyValueStore][] = [
  ["memory", () => new MemoryKeyValueStore()],
  ["sqlite", () => new SqliteKeyValueStore(testDatabase())],
];

describe.each(keyValueStores)("%s key-value store", (_, make) => {
  it("keeps values apart from the settings", async () => {
    const store = make();
    expect(await store.get("backboard.assistant_id")).toBeUndefined();
    await store.set("backboard.assistant_id", "asst-1");
    await store.set("backboard.assistant_id", "asst-2");
    expect(await store.get("backboard.assistant_id")).toBe("asst-2");
  });
});
