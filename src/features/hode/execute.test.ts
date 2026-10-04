import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import { spoken } from "../../lib/spoken";
import type { TTSProvider } from "../../providers/interfaces";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { MockPerception } from "../../providers/mock-perception";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { ExcelScene } from "../../stage/scenes/excel";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { HodeRuntime, PRESS_SETTLE_MS } from "./runtime";
import type { TaskPack } from "../../lib/types";
import { CHECKPOINT_EVERY, PREVIEW_MS, initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, el, guideAction, obs } from "./test-fixtures";

const words = spoken("en");

function fold(state: HodeState, ...events: HodeEvent[]): Transition {
  let t: Transition = { state, effects: [] };
  for (const event of events) t = step(t.state, event);
  return t;
}

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);
const said = (t: Transition): string[] => t.effects.flatMap((e) => (e.type === "say" ? [e.text] : []));

const PIVOT_ACTION = guideAction({
  speech: "Click PivotTable.",
  target: { elementId: "button:PivotTable", bounds: { x: 0, y: 40, width: 60, height: 50 }, confidence: 0.95, label: "PivotTable" },
  skill: "excel.pivot.create",
  assistanceLevel: "guide",
});

/** Agent · Do it for me, the first step's action ready: Hodey is about to click Insert. */
function acting(pack: TaskPack = PACK): Transition {
  return fold(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "do it", pack, mode: "agent", agentStyle: "execute" },
    { type: "SKILL_LOADED", skillId: pack.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] },
  );
}

/** Hodey's click on Insert worked; step two (PivotTable) is being prepared. */
function afterFirstStep(pack: TaskPack = PACK): Transition {
  const t = acting(pack);
  return step(t.state, { type: "HODEY_ACTED", requestId: t.state.requestId, observation: INSERT_SELECTED });
}

describe("Agent · Do it for me", () => {
  it("previews the click, then asks for it, instead of waiting for the learner", () => {
    const t = acting();
    expect(t.state).toMatchObject({ phase: "acting", agentStyle: "execute" });
    const perform = t.effects.find((e) => e.type === "perform");
    expect(perform).toEqual({
      type: "perform",
      requestId: t.state.requestId,
      delayMs: PREVIEW_MS,
      request: { target: { ...guideAction().target!, bounds: { x: 50, y: 0, width: 40, height: 20 } }, button: "left", name: "Insert", observedAt: HOME_SELECTED.at },
    });
    expect(said(t)).toEqual([words.doing("Insert", "left")]);
    expect(types(t)).toContain("renderOverlay");
    expect(types(t)).not.toContain("startStuckTimer");
  });

  it("only ever clicks the step's own control, whatever the model points at", () => {
    const begun = fold(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "do it", pack: PACK, mode: "agent", agentStyle: "execute" },
      { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
      { type: "OBSERVED", observation: HOME_SELECTED },
    ).state;
    const elsewhere = guideAction({ target: { elementId: "tab item:Data", bounds: { x: 100, y: 0, width: 40, height: 20 }, confidence: 0.99, label: "Insert" } });
    const t = step(begun, { type: "ACTION_READY", requestId: begun.requestId, action: elsewhere, failures: [] });
    expect(t.state).toMatchObject({ phase: "guiding", handedBack: true });
    expect(types(t)).not.toContain("perform");
    const unseen = guideAction({ target: { elementId: "button:Delete", bounds: { x: 0, y: 0, width: 10, height: 10 }, confidence: 0.99, label: "Insert" } });
    expect(types(step(begun, { type: "ACTION_READY", requestId: begun.requestId, action: unseen, failures: [] }))).not.toContain("perform");
  });

  it("clicks where the screen read saw the control, not where the model said it was", () => {
    const begun = acting().state;
    const reasoning = { ...begun, phase: "reasoning" as const, requestId: begun.requestId + 1 };
    const moved = guideAction({ target: { ...guideAction().target!, bounds: { x: 900, y: 900, width: 40, height: 20 } } });
    const perform = step(reasoning, { type: "ACTION_READY", requestId: reasoning.requestId, action: moved, failures: [] }).effects.find((e) => e.type === "perform");
    expect(perform).toMatchObject({ request: { target: { bounds: { x: 50, y: 0, width: 40, height: 20 } } } });
  });

  it("right-clicks a step the pack marks as a right-click", () => {
    const pack: TaskPack = { ...PACK, steps: [{ ...PACK.steps[0], press: "right" }, PACK.steps[1]] };
    const perform = acting(pack).effects.find((e) => e.type === "perform");
    expect(perform).toMatchObject({ request: { button: "right" } });
  });

  it("moves on once its click finished the step, without counting it as the learner's skill", () => {
    const t = afterFirstStep();
    expect(t.state).toMatchObject({ phase: "observing", stepIndex: 1, hodeyDid: 1, learnedSkills: [] });
    expect(types(t)).toContain("loadSkill");
    expect(types(t)).not.toContain("recordOutcome");
  });

  it("drops a click result once the learner paused", () => {
    const t = acting();
    const paused = step(t.state, { type: "PAUSE" }).state;
    expect(step(paused, { type: "HODEY_ACTED", requestId: t.state.requestId, observation: INSERT_SELECTED }).state).toBe(paused);
  });

  it("stops at a checkpoint step so the learner can check its work", () => {
    const pack: TaskPack = { ...PACK, steps: [{ ...PACK.steps[0], checkpoint: true }, PACK.steps[1]] };
    const t = afterFirstStep(pack);
    expect(t.state).toMatchObject({ phase: "checkpoint", stepIndex: 1 });
    expect(said(t)).toEqual([words.checkpoint(PACK.steps[0].objective)]);
    expect(types(t)).not.toContain("loadSkill");

    const resumed = step(t.state, { type: "RESUME" });
    expect(resumed.state).toMatchObject({ phase: "observing", stepIndex: 1, agentStyle: "execute" });
    expect(types(resumed)).toEqual(["loadSkill"]);
  });

  it("hands the rest to the learner when they take over at a checkpoint", () => {
    const pack: TaskPack = { ...PACK, steps: [{ ...PACK.steps[0], checkpoint: true }, PACK.steps[1]] };
    const taken = step(afterFirstStep(pack).state, { type: "LET_ME_TRY" });
    expect(taken.state).toMatchObject({ phase: "observing", stepIndex: 1, agentStyle: "guide" });
    expect(types(taken)).toEqual(["loadSkill"]);
  });

  it(`checks in after ${CHECKPOINT_EVERY} steps even when the pack marks none`, () => {
    const steps = Array.from({ length: CHECKPOINT_EVERY + 1 }, (_, i) => ({ ...PACK.steps[0], id: `s${i}` }));
    const pack: TaskPack = { ...PACK, steps };
    let t = acting(pack);
    for (let i = 1; i < CHECKPOINT_EVERY; i++) {
      t = fold(
        t.state,
        { type: "HODEY_ACTED", requestId: t.state.requestId, observation: INSERT_SELECTED },
        { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
        { type: "OBSERVED", observation: HOME_SELECTED },
      );
      t = step(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guideAction(), failures: [] });
      expect(t.state.phase).toBe("acting");
    }
    const last = step(t.state, { type: "HODEY_ACTED", requestId: t.state.requestId, observation: INSERT_SELECTED });
    expect(last.state).toMatchObject({ phase: "checkpoint", stepIndex: CHECKPOINT_EVERY });
  });

  it("finishes the Hode after its last step and asks the learner to check the result", () => {
    const t = afterFirstStep();
    const second = fold(
      t.state,
      { type: "SKILL_LOADED", skillId: "excel.pivot.create", record: null },
      { type: "OBSERVED", observation: INSERT_SELECTED },
    );
    const ready = step(second.state, { type: "ACTION_READY", requestId: second.state.requestId, action: PIVOT_ACTION, failures: [] });
    const done = step(ready.state, { type: "HODEY_ACTED", requestId: ready.state.requestId, observation: FIELDS_VISIBLE });
    expect(done.state).toMatchObject({ phase: "success", hodeyDid: 2, learnedSkills: [] });
    expect(said(done)).toEqual([words.hodeyFinished]);
    expect(types(done)).not.toContain("recordOutcome");
  });

  it("tries again once when its click didn't finish the step, then hands the step to the learner", () => {
    const t = acting();
    const retry = step(t.state, { type: "HODEY_ACTED", requestId: t.state.requestId, observation: HOME_SELECTED });
    expect(retry.state).toMatchObject({ phase: "reasoning", hodeyTries: 1, handedBack: false });
    const again = step(retry.state, { type: "ACTION_READY", requestId: retry.state.requestId, action: guideAction(), failures: [] });
    expect(again.state.phase).toBe("acting");
    const handed = step(again.state, { type: "HODEY_ACTED", requestId: again.state.requestId, observation: HOME_SELECTED });
    expect(handed.state).toMatchObject({ phase: "reasoning", handedBack: true });
    const guided = step(handed.state, { type: "ACTION_READY", requestId: handed.state.requestId, action: guideAction(), failures: [] });
    expect(guided.state.phase).toBe("guiding");
    expect(types(guided)).toContain("startStuckTimer");
  });

  it("gives the step to the learner when the click itself failed", () => {
    const t = acting();
    const failed = step(t.state, { type: "PERFORM_FAILED", requestId: t.state.requestId, message: "The control moved" });
    expect(failed.state).toMatchObject({ phase: "guiding", handedBack: true });
    expect(said(failed)).toEqual([`${words.overToYou} ${guideAction().speech}`]);
    expect(types(failed)).toContain("startStuckTimer");
  });

  it("resumes doing the next step after the learner finished a handed-back one", () => {
    const t = acting();
    const failed = step(t.state, { type: "PERFORM_FAILED", requestId: t.state.requestId, message: "The control moved" });
    const next = step(failed.state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(next.state).toMatchObject({ phase: "observing", stepIndex: 1, handedBack: false });
    expect(types(next)).toContain("recordOutcome");
  });

  it("acknowledges a handed-back step the learner did before its next click, and never praises its own", () => {
    const t = acting();
    const failed = step(t.state, { type: "PERFORM_FAILED", requestId: t.state.requestId, message: "The control moved" });
    const next = fold(
      failed.state,
      { type: "LEARNER_ACTED", observation: INSERT_SELECTED },
      { type: "SKILL_LOADED", skillId: "excel.pivot.create", record: null },
      { type: "OBSERVED", observation: INSERT_SELECTED },
    );
    const owed = next.state.pendingAck;
    const pressing = step(next.state, { type: "ACTION_READY", requestId: next.state.requestId, action: PIVOT_ACTION, failures: [] });
    const doing = words.doing("PivotTable", "left");
    expect(said(pressing)).toEqual([owed ? `${owed} ${doing}` : doing]);
    expect(pressing.state.pendingAck).toBeUndefined();
    const done = step(pressing.state, { type: "HODEY_ACTED", requestId: pressing.state.requestId, observation: FIELDS_VISIBLE });
    expect(done.state).toMatchObject({ ack: undefined, pendingAck: undefined });
  });

  it("never clicks a control it isn't sure about", () => {
    const begun = acting().state;
    const unsure = guideAction({ target: { ...guideAction().target!, confidence: 0.7 } });
    const reasoning = { ...begun, phase: "reasoning" as const, requestId: begun.requestId + 1 };
    const t = step(reasoning, { type: "ACTION_READY", requestId: reasoning.requestId, action: unsure, failures: [] });
    expect(t.state).toMatchObject({ phase: "guiding", handedBack: true });
    expect(types(t)).not.toContain("perform");
  });

  it("lets the learner take over before the click lands", () => {
    const t = acting();
    const taken = step(t.state, { type: "LET_ME_TRY" });
    expect(taken.state).toMatchObject({ phase: "guiding", agentStyle: "guide" });
    expect(taken.state.requestId).toBeGreaterThan(t.state.requestId);
    expect(types(taken)).toContain("stopSpeech");
    expect(said(taken)).toEqual([guideAction().speech]);
  });

  it("switching to teach mode mid-click cancels the click and re-plans", () => {
    const t = acting();
    const switched = step(t.state, { type: "SET_MODE", mode: "teach" });
    expect(switched.state.phase).toBe("reasoning");
    expect(switched.state.requestId).toBeGreaterThan(t.state.requestId);
  });

  it("'do it for me' while guiding turns on Agent · Do it for me and acts on the current step", () => {
    const guiding = fold(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "teach", pack: PACK, mode: "teach" },
      { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
      { type: "OBSERVED", observation: HOME_SELECTED },
      { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: "hint" }), failures: [] },
    ).state;
    const t = step(guiding, { type: "SET_AGENT_STYLE", style: "execute" });
    expect(t.state).toMatchObject({ mode: "agent", agentStyle: "execute", phase: "reasoning" });
  });

  it("never acts on the iPhone mirror", () => {
    const phone: TaskPack = { ...PACK, surface: "phone" };
    expect(acting(phone).state.phase).toBe("guiding");
  });

  it("guide style still waits for the learner", () => {
    const t = fold(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "guide", pack: PACK, mode: "agent", agentStyle: "guide" },
      { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
      { type: "OBSERVED", observation: HOME_SELECTED },
      { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] },
    );
    expect(t.state.phase).toBe("guiding");
    expect(types(t)).not.toContain("perform");
  });
});

describe("Agent · Do it for me on an open-ended Hode", () => {
  it("guides instead: without a task pack nothing limits what the model could click", () => {
    const screen = obs([el("Insert", "tab item", { bounds: { x: 50, y: 0, width: 40, height: 20 } })]);
    const t = fold(
      initialState,
      { type: "START_HODE" },
      { type: "GOAL_SUBMITTED", goal: "do something", openAllowed: true, mode: "agent", agentStyle: "execute" },
      { type: "OBSERVED", observation: screen },
      { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] },
    );
    expect(t.state.phase).toBe("guiding");
    expect(types(t)).not.toContain("perform");
  });
});

describe("Agent · Do it for me end to end", () => {
  const GOAL = "Teach me how to make a pivot table in Excel";

  function setup() {
    const scene = new ExcelScene();
    const perception = new MockPerception(() => scene);
    const skills = new MemorySkillStore();
    const lines: string[] = [];
    const tts: TTSProvider = {
      async speak(text) {
        for await (const chunk of text) lines.push(chunk);
      },
      async stop() {},
      async healthCheck() {
        return true;
      },
    };
    const runtime = new HodeRuntime({ perception, reasoners: [new TaskPackReasoningProvider()], skills, bus: new LocalBus(), tts });
    return { scene, skills, lines, runtime, perception };
  }

  /** Lets previews, presses and screen reads run. */
  const run = (ms = PREVIEW_MS + PRESS_SETTLE_MS) => vi.advanceTimersByTimeAsync(ms * MAX_STEPS);
  const MAX_STEPS = 6;

  afterEach(() => vi.useRealTimers());

  it("does the PivotTable Hode, stops at the checkpoint, and finishes after the learner checks", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.runtime.dispatch({ type: "START_HODE" });
    h.runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent", agentStyle: "execute" });
    await run();
    expect(h.runtime.getState()).toMatchObject({ phase: "checkpoint", stepIndex: 2, hodeyDid: 2 });
    expect(h.scene.snapshot().elements.some((e) => e.name === "OK")).toBe(true);

    h.runtime.dispatch({ type: "RESUME" });
    await run();
    expect(h.runtime.getState()).toMatchObject({ phase: "success", hodeyDid: 5, learnedSkills: [] });
    expect(h.lines.at(-1)).toBe(words.hodeyFinished);
    expect(await h.skills.get("excel.pivot.create")).toBeNull();
  });

  it("never presses once the learner paused during the preview", async () => {
    vi.useFakeTimers();
    const h = setup();
    const perform = vi.spyOn(h.perception, "perform");
    h.runtime.dispatch({ type: "START_HODE" });
    h.runtime.dispatch({ type: "GOAL_SUBMITTED", goal: GOAL, pack: matchGoal(GOAL, TASK_PACKS), mode: "agent", agentStyle: "execute" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.runtime.getState().phase).toBe("acting");
    h.runtime.dispatch({ type: "PAUSE" });
    await run();
    expect(perform).not.toHaveBeenCalled();
    expect(h.runtime.getState().phase).toBe("paused");
  });
});
