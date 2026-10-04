import { describe, expect, it } from "vitest";
import type { SkillRecord } from "../../lib/types";
import { PushLedger, mergeSettings, planPull } from "./merge";
import { EMPTY_SNAPSHOT, type RemoteHode, type Snapshot } from "./types";

const skill = (id: string, seen: string, level: SkillRecord["last_assistance_level"] = "guide"): SkillRecord => ({
  skill_id: id,
  status: "learning",
  confidence: 0.5,
  success_count: 1,
  failure_count: 0,
  last_assistance_level: level,
  last_seen_at: seen,
});

const hode = (id: string): RemoteHode => ({ id, goal: `goal ${id}`, pack_id: null, open: false, started_at: "2026-10-01T10:00:00.000Z", ended_at: null, outcome: null });

const snap = (part: Partial<Snapshot>): Snapshot => ({ ...EMPTY_SNAPSHOT, ...part });

describe("planPull", () => {
  it("takes remote skills that are newer or missing, and keeps local on ties", () => {
    const local = snap({ skills: [skill("excel.a", "2026-10-02T00:00:00.000Z", "hint"), skill("excel.b", "2026-10-02T00:00:00.000Z", "hint")] });
    const remote = snap({ skills: [skill("excel.a", "2026-10-03T00:00:00.000Z"), skill("excel.b", "2026-10-02T00:00:00.000Z"), skill("excel.c", "2026-10-01T00:00:00.000Z")] });
    expect(planPull(local, remote, []).skills.map((s) => s.skill_id)).toEqual(["excel.a", "excel.c"]);
  });

  it("inserts only Hodes, events, chats and messages that are missing locally", () => {
    const local = snap({ hodes: [hode("h1")], events: [{ hode_id: "h1", seq: 0, kind: "hint", detail: null, at: "t" }], chats: [{ id: "c1", title: "a", created_at: "t", updated_at: "t" }] });
    const remote = snap({
      hodes: [hode("h1"), hode("h2")],
      events: [
        { hode_id: "h1", seq: 0, kind: "hint", detail: null, at: "t" },
        { hode_id: "h2", seq: 0, kind: "step_done", detail: "Select data", at: "t" },
      ],
      chats: [{ id: "c1", title: "a", created_at: "t", updated_at: "t" }, { id: "c2", title: "b", created_at: "t", updated_at: "t" }],
      messages: [{ id: "m1", chat_id: "c2", role: "user", content: "hi", context: null, web: null, at: "t" }],
    });
    const plan = planPull(local, remote, []);
    expect(plan.hodes.map((h) => h.id)).toEqual(["h2"]);
    expect(plan.events.map((e) => e.hode_id)).toEqual(["h2"]);
    expect(plan.chats.map((c) => c.id)).toEqual(["c2"]);
    expect(plan.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("never pulls back something deleted on this PC", () => {
    const remote = snap({
      skills: [skill("excel.a", "2026-10-03T00:00:00.000Z")],
      chats: [{ id: "c1", title: "a", created_at: "t", updated_at: "t" }],
      messages: [{ id: "m1", chat_id: "c1", role: "user", content: "hi", context: null, web: null, at: "t" }],
    });
    const plan = planPull(EMPTY_SNAPSHOT, remote, [{ table: "skills", id: "excel.a" }, { table: "chats", id: "c1" }]);
    expect(plan).toEqual(EMPTY_SNAPSHOT);
  });
});

describe("mergeSettings", () => {
  const defaults = { theme: "dark" };
  const isDefault = (value: unknown) => JSON.stringify(value) === JSON.stringify(defaults);

  it("pushes local when the cloud has nothing", () => {
    expect(mergeSettings({ local: { theme: "light" }, base: undefined, remote: undefined, isDefault })).toEqual({ push: { theme: "light" }, base: { theme: "light" } });
  });

  it("applies a remote edit when this PC hasn't changed anything since the last sync", () => {
    expect(mergeSettings({ local: { theme: "dark" }, base: { theme: "dark" }, remote: { theme: "light" }, isDefault })).toEqual({ apply: { theme: "light" }, base: { theme: "light" } });
  });

  it("lets a local edit win", () => {
    expect(mergeSettings({ local: { theme: "light" }, base: { theme: "dark" }, remote: { theme: "system" }, isDefault })).toEqual({ push: { theme: "light" }, base: { theme: "light" } });
  });

  it("gives a fresh PC with default settings the account's settings", () => {
    expect(mergeSettings({ local: defaults, base: undefined, remote: { theme: "light" }, isDefault })).toEqual({ apply: { theme: "light" }, base: { theme: "light" } });
  });

  it("does nothing when everything matches", () => {
    expect(mergeSettings({ local: { theme: "light" }, base: { theme: "light" }, remote: { theme: "light" }, isDefault })).toEqual({ base: { theme: "light" } });
  });
});

describe("PushLedger", () => {
  it("only hands back rows that changed since they were last pushed", () => {
    const ledger = new PushLedger();
    const first = snap({ hodes: [hode("h1"), hode("h2")] });
    expect(ledger.changed(first).hodes).toHaveLength(2);
    ledger.commit(first);
    const next = snap({ hodes: [hode("h1"), { ...hode("h2"), outcome: "completed" }] });
    expect(ledger.changed(next).hodes.map((h) => h.id)).toEqual(["h2"]);
  });

  it("forgets everything on reset (a new account)", () => {
    const ledger = new PushLedger();
    const rows = snap({ hodes: [hode("h1")] });
    ledger.commit(rows);
    ledger.reset();
    expect(ledger.changed(rows).hodes).toHaveLength(1);
  });
});
