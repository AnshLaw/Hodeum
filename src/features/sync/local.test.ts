import { describe, expect, it } from "vitest";
import { SqliteChatStore, SqliteLearningStore } from "../../data/sqlite-stores";
import { testDatabase } from "../../data/test-sql";
import { SqliteSyncSource } from "./local";
import { EMPTY_SNAPSHOT } from "./types";

const AT = "2026-10-03T10:00:00.000Z";
const OUTCOME = { completed: true, mistakes: 0, level: "guide", escalated: false } as const;

describe("SqliteSyncSource", () => {
  it("reads local rows as cloud rows, numbering each Hode's events", async () => {
    const db = testDatabase();
    const learning = new SqliteLearningStore(db);
    const chats = new SqliteChatStore(db);
    await learning.recordOutcome("excel.select_data", OUTCOME);
    await learning.startHode({ id: "h1", goal: "pivot", packId: "excel-pivot", open: false, startedAt: AT });
    await learning.logEvent({ hodeId: "h1", kind: "step_done", detail: "Select data", at: AT });
    await learning.logEvent({ hodeId: "h1", kind: "hint", at: AT });
    await learning.endHode("h1", "completed", AT);
    const chat = await chats.createChat("Pivot help", AT);
    await chats.append({ id: "m1", chatId: chat.id, role: "user", content: "what is a pivot?", web: { query: "pivot table", sources: [] }, at: AT });

    const snapshot = await new SqliteSyncSource(db).snapshot();

    expect(snapshot.skills.map((s) => s.skill_id)).toEqual(["excel.select_data"]);
    expect(snapshot.hodes).toEqual([{ id: "h1", goal: "pivot", pack_id: "excel-pivot", open: false, started_at: AT, ended_at: AT, outcome: "completed" }]);
    expect(snapshot.events.map((e) => [e.seq, e.kind, e.detail])).toEqual([
      [0, "step_done", "Select data"],
      [1, "hint", null],
    ]);
    expect(snapshot.chats.map((c) => c.title)).toEqual(["Pivot help"]);
    expect(snapshot.messages[0]).toMatchObject({ id: "m1", role: "user", web: { query: "pivot table", sources: [] } });
  });

  it("writes pulled rows so the local stores see them", async () => {
    const db = testDatabase();
    const source = new SqliteSyncSource(db);
    await source.write({
      ...EMPTY_SNAPSHOT,
      skills: [{ skill_id: "windows.zip", status: "mastered", confidence: 0.9, success_count: 4, failure_count: 0, last_assistance_level: "independent", last_seen_at: AT }],
      hodes: [{ id: "h9", goal: "zip a folder", pack_id: null, open: true, started_at: AT, ended_at: null, outcome: null }],
      events: [
        { hode_id: "h9", seq: 1, kind: "hint", detail: null, at: AT },
        { hode_id: "h9", seq: 0, kind: "step_done", detail: "Open Explorer", at: AT },
      ],
      chats: [{ id: "c9", title: "Zip", created_at: AT, updated_at: AT }],
      messages: [{ id: "m9", chat_id: "c9", role: "hodey", content: "Right-click it.", context: null, web: null, at: AT }],
    });

    const learning = new SqliteLearningStore(db);
    expect((await learning.listSkills())[0].status).toBe("mastered");
    expect((await learning.getHode("h9"))?.events.map((e) => e.kind)).toEqual(["step_done", "hint"]);
    expect((await new SqliteChatStore(db).messages("c9"))[0].content).toBe("Right-click it.");
  });

  it("updates a skill that already exists locally", async () => {
    const db = testDatabase();
    const learning = new SqliteLearningStore(db);
    await learning.recordOutcome("excel.select_data", OUTCOME);
    const newer = { ...(await learning.listSkills())[0], last_assistance_level: "observe" as const, last_seen_at: "2030-01-01T00:00:00.000Z" };
    await new SqliteSyncSource(db).write({ ...EMPTY_SNAPSHOT, skills: [newer] });
    expect((await learning.listSkills())[0].last_assistance_level).toBe("observe");
  });
});
