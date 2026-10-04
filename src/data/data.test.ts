import { describe, expect, it } from "vitest";
import { initialState, type HodeEvent, type HodeState } from "../features/hode/model";
import { step } from "../features/hode/reducer";
import { DATA_SELECTED, FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, guideAction, skillRecord } from "../features/hode/test-fixtures";
import { MemoryLearningStore } from "./memory-stores";
import { HodeRecorder } from "./recorder";
import { computeStats, masteryOf, streakDays } from "./stats";

function drive(recorder: HodeRecorder, events: HodeEvent[], start: HodeState = initialState): HodeState {
  let state = start;
  for (const event of events) {
    const next = step(state, event).state;
    recorder.observe(event, state, next);
    state = next;
  }
  return state;
}

const HODE: HodeEvent[] = [
  { type: "START_HODE" },
  { type: "GOAL_SUBMITTED", goal: "pivot table", pack: PACK },
  { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record: null },
  { type: "OBSERVED", observation: HOME_SELECTED },
  { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] },
  { type: "LEARNER_ACTED", observation: DATA_SELECTED },
];

describe("HodeRecorder", () => {
  it("records a Hode's start, mistakes, steps and completion", async () => {
    const store = new MemoryLearningStore();
    let id = 0;
    const recorder = new HodeRecorder(store, undefined, () => `h${++id}`, () => "2026-10-03T10:00:00.000Z");
    let state = drive(recorder, HODE);
    state = drive(recorder, [{ type: "ACTION_READY", requestId: 2, action: guideAction({ kind: "correct", speech: "You opened Data." }), failures: [] }], state);
    state = drive(recorder, [{ type: "HINT_REQUESTED" }, { type: "LEARNER_ACTED", observation: INSERT_SELECTED }], state);
    drive(recorder, [
      { type: "SKILL_LOADED", skillId: "excel.pivot.create", record: null },
      { type: "OBSERVED", observation: INSERT_SELECTED },
      { type: "ACTION_READY", requestId: 4, action: guideAction(), failures: [] },
      { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE },
    ], state);
    await recorder.flushed();
    const detail = await store.getHode("h1");
    expect(detail).toMatchObject({ goal: "pivot table", packId: "test-pack", outcome: "completed" });
    expect(detail?.events.map((e) => e.kind)).toEqual(["mistake", "hint", "step_done", "step_done"]);
    expect(detail?.events[2].detail).toBe("Open the Insert tab");
  });

  it("marks a Hode the learner ended early", async () => {
    const store = new MemoryLearningStore();
    const recorder = new HodeRecorder(store, undefined, () => "h1");
    drive(recorder, [...HODE.slice(0, 2), { type: "END_HODE" }]);
    await recorder.flushed();
    expect((await store.getHode("h1"))?.outcome).toBe("ended");
  });
});

describe("learning stats", () => {
  const hode = (endedAt: string, outcome: "completed" | "ended" = "completed") => ({ id: endedAt, goal: "g", open: false, startedAt: new Date(Date.parse(endedAt) - 600_000).toISOString(), endedAt, outcome });

  it("counts a streak of consecutive days, surviving until the end of today", () => {
    const now = new Date(2026, 9, 3, 18);
    const days = [new Date(2026, 9, 2, 12), new Date(2026, 9, 1, 12), new Date(2026, 8, 29, 12)].map((d) => hode(d.toISOString()));
    expect(streakDays(days, now)).toBe(2);
    expect(streakDays([...days, hode(new Date(2026, 9, 3, 9).toISOString())], now)).toBe(3);
  });

  it("summarises Hodes, skills and time", () => {
    const stats = computeStats([hode("2026-10-03T10:00:00.000Z"), hode("2026-10-03T11:00:00.000Z", "ended")], [{ ...skillRecord("independent"), status: "mastered" }, skillRecord("hint", "excel.pivot.create")], new Date("2026-10-03T12:00:00Z"));
    expect(stats).toMatchObject({ hodesCompleted: 1, skillsMastered: 1, skillsLearning: 1, minutesLearning: 20 });
  });

  it("maps help level to mastery", () => {
    expect(masteryOf(skillRecord("independent"))).toBe(1);
  });
});
