import { describe, expect, it } from "vitest";
import { LocalBus } from "../../lib/bus";
import { MemoryChatStore, MemoryLearningStore } from "../../data/memory-stores";
import { trackDeletions } from "./deletions";

describe("trackDeletions", () => {
  it("announces skill resets and chat deletions after they succeed", async () => {
    const bus = new LocalBus();
    const learning = new MemoryLearningStore();
    const chats = new MemoryChatStore();
    const seen: unknown[] = [];
    bus.on("sync:deleted", (t) => seen.push(t));
    trackDeletions(learning, chats, bus);
    const chat = await chats.createChat("hi", "2026-10-03T10:00:00.000Z");
    await learning.resetSkill("excel.select_data");
    await chats.deleteChat(chat.id);
    expect(seen).toEqual([
      { table: "skills", id: "excel.select_data" },
      { table: "chats", id: chat.id },
    ]);
    expect(await chats.listChats()).toEqual([]);
  });
});
