import { describe, expect, it } from "vitest";
import { padRect } from "../../lib/coords";
import { spoken } from "../../lib/spoken";
import type { HodeMode, ScreenObservation, TaskPack, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { REGION_PADDING_PX } from "./region";
import { FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, guideAction, obs, skillRecord, tab } from "./test-fixtures";

/** Teach Mode's learning loop (docs/teach-loop.md): orient, ask first, confirm with why, fade. */

const EN = spoken("en");
const CONCEPT = "A PivotTable sums up long lists.";
const TAUGHT: TaskPack = { ...PACK, concept: CONCEPT };
const INSERT_WHY = PACK.steps[0].explain;
const HINT = "Which tab adds things?";

/** Runs events in order, keeping every effect along the way. */
function play(state: HodeState, ...events: HodeEvent[]): Transition {
  return events.reduce<Transition>(
    (t, event) => {
      const next = step(t.state, event);
      return { state: next.state, effects: [...t.effects, ...next.effects] };
    },
    { state, effects: [] },
  );
}

const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);
const overlays = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "renderOverlay" }> => e.type === "renderOverlay").map((e) => e.primitives);

const hint = (overrides: Partial<TeachingAction> = {}) => guideAction({ assistanceLevel: "hint", speech: HINT, ...overrides });

function begin(mode: HodeMode, pack: TaskPack = TAUGHT, record = null as ReturnType<typeof skillRecord> | null): Transition {
  return play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "make a pivot table", pack, mode },
    { type: "SKILL_LOADED", skillId: pack.steps[0].skill, record },
  );
}

/** A Teach Hode guiding its first step with a hint. */
function hinting(pack: TaskPack = TAUGHT): Transition {
  const t = begin("teach", pack);
  return play(t.state, { type: "OBSERVED", observation: HOME_SELECTED }, { type: "ACTION_READY", requestId: 1, action: hint(), failures: [] });
}

/** The next step's guidance arriving after the learner finished one. */
function nextGuidance(t: Transition, observation: ScreenObservation, action: TeachingAction): Transition {
  const next = play(t.state, { type: "SKILL_LOADED", skillId: t.state.pack!.steps[t.state.stepIndex].skill, record: null }, { type: "OBSERVED", observation });
  return play(next.state, { type: "ACTION_READY", requestId: next.state.requestId, action, failures: [] });
}

describe("orient: a Teach Hode opens with what the learner is about to make", () => {
  it("says the idea and who does the clicking ahead of the first question, once", () => {
    const t = hinting();
    expect(said(t)).toEqual([`${CONCEPT} ${EN.youDoTheClicking} ${HINT}`]);
    expect(t.state.pendingIntro).toBeUndefined();
    const again = play(t.state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(said(play(again.state, { type: "ACTION_READY", requestId: again.state.requestId, action: hint(), failures: [] }))).toEqual([HINT]);
  });

  it("says it while asking the learner to open the app, if it isn't open yet", () => {
    const t = play(begin("teach").state, { type: "OBSERVED", observation: { ...HOME_SELECTED, app: "Word" } });
    expect(said(t)).toEqual([`${CONCEPT} ${EN.youDoTheClicking} ${EN.switchToApp("Excel")}`]);
  });

  it("is Teach's alone: Help and Agent get straight to it, and a pack without an idea says nothing extra", () => {
    expect(begin("help").state.pendingIntro).toBeUndefined();
    expect(begin("agent").state.pendingIntro).toBeUndefined();
    expect(begin("teach", PACK).state.pendingIntro).toBeUndefined();
  });
});

describe("ask first: a hint lights up the area that holds the answer, never the answer", () => {
  it("rings the row of tabs, without a label, for a hint about a tab", () => {
    const [primitives] = overlays(hinting());
    expect(primitives).toEqual([{ kind: "highlight", bounds: padRect({ x: 0, y: 0, width: 140, height: 20 }, REGION_PADDING_PX), emphasis: "broad" }]);
  });

  it("draws nothing when the target stands alone", () => {
    const t = begin("teach");
    const lone = play(t.state, { type: "OBSERVED", observation: obs([tab("Insert", 1)]) }, { type: "ACTION_READY", requestId: 1, action: hint(), failures: [] });
    expect(overlays(lone)).toEqual([]);
    expect(lone.effects.some((e) => e.type === "clearOverlay")).toBe(true);
  });

  it("points at the control itself once the learner needs more help", () => {
    const t = hinting();
    const raised = play(t.state, { type: "STUCK_TIMEOUT" });
    const guided = play(raised.state, { type: "ACTION_READY", requestId: raised.state.requestId, action: guideAction({ assistanceLevel: "guide", speech: "Open Insert." }), failures: [] });
    expect(overlays(guided)[0]).toContainEqual(expect.objectContaining({ kind: "highlight", emphasis: "precise", label: "Insert" }));
  });
});

describe("confirm with why: a step done right is confirmed with the idea behind it", () => {
  it("adds the why to the acknowledgement of a step worked out from a hint", () => {
    const done = play(hinting().state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    const ack = done.state.pendingAck!;
    expect(EN.stepDone).toContain(ack);
    const next = nextGuidance(done, INSERT_SELECTED, guideAction({ assistanceLevel: "hint", speech: "Far left.", target: { elementId: "button:PivotTable", bounds: { x: 0, y: 40, width: 60, height: 50 }, confidence: 0.95, label: "PivotTable" } }));
    expect(said(next)).toEqual([`${ack} ${INSERT_WHY} Far left.`]);
    expect(next.state).toMatchObject({ ack, reason: INSERT_WHY });
    expect(play(next.state, { type: "LEARNER_ACTED", observation: { ...INSERT_SELECTED, at: 1 } }).state.reason).toBeUndefined();
  });

  it("doesn't say the why twice when a demonstration already gave it", () => {
    let t = hinting();
    for (const level of ["guide", "demonstrate"] as const) {
      t = play(t.state, { type: "STUCK_TIMEOUT" });
      t = play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guideAction({ assistanceLevel: level, speech: `Click Insert (${level}).` }), failures: [] });
    }
    expect(said(t).at(-1)).toContain(INSERT_WHY);
    const done = play(t.state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(done.state.pendingReason).toBeUndefined();
  });

  it("keeps Help and Agent acknowledgements short", () => {
    const help = play(begin("help").state, { type: "OBSERVED", observation: HOME_SELECTED }, { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] });
    const raised = play(help.state, { type: "HINT_REQUESTED" });
    const hinted = play(raised.state, { type: "ACTION_READY", requestId: raised.state.requestId, action: hint(), failures: [] });
    expect(play(hinted.state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED }).state.pendingReason).toBeUndefined();
  });

  it("says a skill picked up earlier in this Hode is now the learner's, rather than remembered from before", () => {
    const thrice: TaskPack = { ...TAUGHT, steps: [PACK.steps[0], { ...PACK.steps[1], skill: PACK.steps[0].skill }, { ...PACK.steps[1], id: "third" }] };
    const firstDone = play(hinting(thrice).state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    const second = play(
      firstDone.state,
      { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: skillRecord("observe") },
      { type: "OBSERVED", observation: INSERT_SELECTED },
    );
    const silent = play(second.state, { type: "ACTION_READY", requestId: second.state.requestId, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] });
    const done = play(silent.state, { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE });
    expect(done.state).toMatchObject({ stepIndex: 2, pendingAck: EN.gotTheHang });
    expect(done.state.pendingReason).toBeUndefined();
    const fresh = play(begin("teach", TAUGHT, skillRecord("observe")).state, { type: "OBSERVED", observation: HOME_SELECTED });
    const remembered = play(fresh.state, { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "observe", speech: "" }), failures: [] }, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(remembered.state.pendingAck).toBe(EN.rememberedOnYourOwn);
    expect(remembered.state.pendingReason).toBeUndefined();
  });
});
