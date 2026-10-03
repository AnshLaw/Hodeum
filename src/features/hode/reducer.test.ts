import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import type { AssistanceLevel } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import {
  DATA_SELECTED,
  FIELDS_VISIBLE,
  HOME_SELECTED,
  INSERT_BOUNDS,
  INSERT_SELECTED,
  PACK,
  annotation,
  guideAction,
  skillRecord,
} from "./test-fixtures";

function fold(state: HodeState, ...events: HodeEvent[]): Transition {
  let t: Transition = { state, effects: [] };
  for (const event of events) t = step(t.state, event);
  return t;
}

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);
const START: HodeEvent[] = [{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "teach me", pack: PACK }];

function reasoning(level: AssistanceLevel = "demonstrate"): HodeState {
  const record = level === "demonstrate" ? null : skillRecord(level);
  return fold(
    initialState,
    ...START,
    { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record },
    { type: "OBSERVED", observation: HOME_SELECTED },
  ).state;
}

function guiding(level: AssistanceLevel = "demonstrate"): HodeState {
  return step(reasoning(level), { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: level }), failures: [] }).state;
}

describe("starting a Hode", () => {
  it("moves from idle to goal entry", () => {
    expect(step(initialState, { type: "START_HODE" }).state.phase).toBe("goal_entry");
  });

  it("ignores a whitespace-only goal", () => {
    const entry = step(initialState, { type: "START_HODE" }).state;
    expect(step(entry, { type: "GOAL_SUBMITTED", goal: "   ", pack: PACK }).state).toBe(entry);
  });

  it("explains when no task pack matches", () => {
    const t = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "write a poem" });
    expect(t.state).toMatchObject({ phase: "goal_entry", notice: COPY.noPack });
    expect(t.effects).toEqual([{ type: "say", text: COPY.noPack }]);
  });

  it("loads the first step's skill, then observes, then reasons", () => {
    const begun = fold(initialState, ...START);
    expect(begun.state.phase).toBe("observing");
    expect(begun.effects).toEqual([{ type: "loadSkill", skillId: "excel.navigation.insert_tab" }]);
    const loaded = step(begun.state, { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record: skillRecord("hint") });
    expect(loaded.state.level).toBe("hint");
    expect(types(loaded)).toEqual(["observe"]);
    const observed = step(loaded.state, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(observed.state).toMatchObject({ phase: "reasoning", requestId: 1 });
    expect(observed.effects[0]).toMatchObject({ type: "reason", requestId: 1, context: { step: { id: "open-insert" } } });
  });
});

describe("showing guidance", () => {
  it("renders the overlay, speaks, and starts the stuck timer", () => {
    const t = step(reasoning(), { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] });
    expect(t.state.phase).toBe("guiding");
    expect(types(t)).toEqual(["renderOverlay", "say", "startStuckTimer"]);
  });

  it("drops stale reasoning results", () => {
    const state = reasoning();
    expect(step(state, { type: "ACTION_READY", requestId: 0, action: guideAction(), failures: [] }).state).toBe(state);
  });

  it("re-observes once on low confidence, then asks for clarification", () => {
    const lowConfidence = guideAction({ target: { elementId: "x", bounds: INSERT_BOUNDS, confidence: 0.4, label: "Insert" } });
    const first = step(reasoning(), { type: "ACTION_READY", requestId: 1, action: lowConfidence, failures: [] });
    expect(first.state).toMatchObject({ phase: "observing", reobserved: true });
    const second = fold(first.state, { type: "OBSERVED", observation: HOME_SELECTED }, { type: "ACTION_READY", requestId: 2, action: lowConfidence, failures: [] });
    expect(second.state.action).toMatchObject({ kind: "clarify", speech: COPY.clarify });
    expect(types(second)).toEqual(["clearOverlay", "say", "startStuckTimer"]);
  });

  it("notes when a fallback provider answered", () => {
    const t = step(reasoning(), { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: ["gemini: quota"] });
    expect(t.state.notice).toBe(COPY.fallbackNotice);
  });
});

describe("verifying learner actions", () => {
  it("corrects a known mistake and raises help", () => {
    const t = step(guiding("guide"), { type: "LEARNER_ACTED", observation: DATA_SELECTED });
    expect(t.state).toMatchObject({ level: "demonstrate", mistakes: 1, escalated: true });
    expect(t.effects[0]).toEqual({ type: "cancelStuckTimer" });
    expect(t.effects[1]).toMatchObject({ type: "reason", context: { correction: "You opened Data. Insert is further left." } });
  });

  it("completes the step, records the outcome, and loads the next skill", () => {
    const t = step(guiding("guide"), { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(t.state).toMatchObject({ phase: "observing", stepIndex: 1, learnedSkills: ["excel.navigation.insert_tab"] });
    expect(t.effects).toContainEqual({ type: "recordOutcome", skillId: "excel.navigation.insert_tab", outcome: { completed: true, mistakes: 0, level: "guide", escalated: false } });
    expect(t.effects.at(-1)).toEqual({ type: "loadSkill", skillId: "excel.pivot.create" });
  });

  it("praises an unaided step", () => {
    const t = step(guiding("observe"), { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(t.effects).toContainEqual({ type: "say", text: COPY.rememberedOnYourOwn });
  });

  it("escalates after repeated unrelated actions", () => {
    const once = step(guiding("hint"), { type: "LEARNER_ACTED", observation: HOME_SELECTED });
    expect(once.state.wrongActions).toBe(1);
    expect(once.effects).toEqual([]);
    const twice = step(once.state, { type: "LEARNER_ACTED", observation: HOME_SELECTED });
    expect(twice.state).toMatchObject({ level: "guide", wrongActions: 0, phase: "reasoning" });
  });

  it("re-reasons when the learner acts while reasoning is in flight", () => {
    const t = step(reasoning(), { type: "LEARNER_ACTED", observation: HOME_SELECTED });
    expect(t.state.requestId).toBe(2);
    expect(step(t.state, { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] }).state).toBe(t.state);
  });

  it("finishes the Hode on the last step", () => {
    const lastStep = { ...guiding("guide"), stepIndex: 1 };
    const t = step(lastStep, { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE });
    expect(t.state).toMatchObject({ phase: "success", learnedSkills: ["excel.pivot.create"] });
    expect(t.effects.at(-1)).toEqual({ type: "say", text: COPY.hodeCompleteSpeech });
  });
});

describe("learner controls", () => {
  it("escalates on the stuck timer", () => {
    const t = step(guiding("hint"), { type: "STUCK_TIMEOUT" });
    expect(t.state).toMatchObject({ level: "guide", escalated: true, mistakes: 0, phase: "reasoning" });
  });

  it("escalates on a hint request", () => {
    const t = step(guiding("observe"), { type: "HINT_REQUESTED" });
    expect(t.state.level).toBe("hint");
    expect(t.effects[0]).toEqual({ type: "cancelStuckTimer" });
  });

  it("explains the current step", () => {
    const t = step(guiding(), { type: "EXPLAIN_REQUESTED" });
    expect(t.state.explanation).toBe("Insert adds things.");
    expect(t.effects).toEqual([{ type: "say", text: "Insert adds things." }]);
  });

  it("steps back to observe on Let me try", () => {
    const t = step(guiding(), { type: "LET_ME_TRY" });
    expect(t.state.level).toBe("observe");
    expect(types(t)).toEqual(["stopSpeech", "clearOverlay", "startStuckTimer"]);
  });

  it("pauses instantly and drops in-flight reasoning", () => {
    const paused = step(reasoning(), { type: "PAUSE" });
    expect(paused.state.phase).toBe("paused");
    expect(types(paused)).toEqual(["clearOverlay", "cancelStuckTimer", "stopSpeech"]);
    expect(step(paused.state, { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] }).state.phase).toBe("paused");
    const resumed = step(paused.state, { type: "RESUME" });
    expect(resumed.state.phase).toBe("observing");
    expect(types(resumed)).toEqual(["observe"]);
  });

  it("ends the Hode from anywhere", () => {
    const t = step(guiding(), { type: "END_HODE" });
    expect(t.state).toEqual(initialState);
    expect(types(t)).toEqual(["clearOverlay", "cancelStuckTimer", "stopSpeech"]);
  });

  it("recovers from a provider failure", () => {
    const failed = step(reasoning(), { type: "PROVIDER_FAILED", requestId: 1, message: "boom" });
    expect(failed.state).toMatchObject({ phase: "recovering", notice: "boom" });
    expect(step(reasoning(), { type: "PROVIDER_FAILED", requestId: 0, message: "old" }).state.phase).toBe("reasoning");
    const retried = step(failed.state, { type: "RETRY" });
    expect(retried.state).toMatchObject({ phase: "observing", notice: undefined });
  });
});

describe("Point & Ask", () => {
  const ask = annotation("ask", INSERT_BOUNDS, "What is this?");

  it("pauses guidance while marking and resumes on cancel", () => {
    const marking = step(guiding(), { type: "ANNOTATE_START" });
    expect(marking.state).toMatchObject({ phase: "annotating", resumePhase: "observing" });
    expect(types(marking)).toEqual(["cancelStuckTimer", "stopSpeech"]);
    const cancelled = step(marking.state, { type: "ANNOTATE_CANCEL" });
    expect(cancelled.state.phase).toBe("observing");
  });

  it("ignores Point & Ask while paused", () => {
    const paused = step(guiding(), { type: "PAUSE" }).state;
    expect(step(paused, { type: "ANNOTATE_START" }).state).toBe(paused);
  });

  it("answers a question about the marked region, then returns to the Hode", () => {
    const submitted = fold(guiding(), { type: "ANNOTATE_START" }, { type: "ANNOTATION_SUBMITTED", annotation: ask });
    expect(submitted.state).toMatchObject({ phase: "observing", question: ask });
    expect(submitted.effects).toEqual([{ type: "observe", region: { x: 34, y: -16, width: 72, height: 52 } }]);
    const reasoned = step(submitted.state, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(reasoned.effects[0]).toMatchObject({ type: "reason", context: { focusRegion: ask, utterance: "What is this?" } });
    const answer = guideAction({ kind: "answer", speech: "That's Insert." });
    const answered = step(reasoned.state, { type: "ACTION_READY", requestId: reasoned.state.requestId, action: answer, failures: [] });
    expect(answered.state.phase).toBe("answering");
    expect(answered.effects[0]).toMatchObject({ type: "renderOverlay", primitives: [{ kind: "pin" }, { kind: "highlight" }] });
    const dismissed = step(answered.state, { type: "DISMISS" });
    expect(dismissed.state).toMatchObject({ phase: "observing", question: undefined });
  });

  it("works without a Hode and returns to idle", () => {
    const answered = fold(initialState, { type: "ANNOTATE_START" }, { type: "ANNOTATION_SUBMITTED", annotation: ask }, { type: "OBSERVED", observation: HOME_SELECTED });
    const done = fold(answered.state, { type: "ACTION_READY", requestId: 1, action: guideAction({ kind: "answer" }), failures: [] }, { type: "DISMISS" });
    expect(done.state.phase).toBe("idle");
  });

  it("keeps a focus region and pins it while idle", () => {
    const focus = annotation("focus", INSERT_BOUNDS);
    const t = fold(initialState, { type: "ANNOTATE_START" }, { type: "ANNOTATION_SUBMITTED", annotation: focus });
    expect(t.state).toMatchObject({ phase: "idle", focusRegion: focus, notice: COPY.focusSet });
    expect(t.effects).toEqual([{ type: "renderOverlay", primitives: [{ kind: "pin", bounds: INSERT_BOUNDS }] }]);
  });
});

describe("open-ended Hodes (no task pack, local vision plans)", () => {
  const OPEN_START: HodeEvent[] = [{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "add a chart", openAllowed: true }];

  it("starts observing instead of refusing when vision is available", () => {
    const t = fold(initialState, ...OPEN_START);
    expect(t.state).toMatchObject({ phase: "observing", open: true, goal: "add a chart", notice: undefined });
    expect(types(t)).toEqual(["observe"]);
  });

  it("asks the model again after every learner action, passing the last instruction", () => {
    const guided = fold(
      initialState,
      ...OPEN_START,
      { type: "OBSERVED", observation: HOME_SELECTED },
      { type: "ACTION_READY", requestId: 1, action: guideAction({ speech: "Open Insert." }), failures: [] },
    ).state;
    const acted = step(guided, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(acted.effects[0]).toEqual({ type: "cancelStuckTimer" });
    expect(acted.effects[1]).toMatchObject({ type: "reason", context: { openGoal: true, lastInstruction: "Open Insert." } });
  });

  it("finishes when the model says the goal is reached", () => {
    const reasoning = fold(initialState, ...OPEN_START, { type: "OBSERVED", observation: HOME_SELECTED }).state;
    const done = step(reasoning, { type: "ACTION_READY", requestId: 1, action: guideAction({ kind: "complete", speech: "Chart added. Nice!" }), failures: [] });
    expect(done.state.phase).toBe("success");
    expect(done.effects).toContainEqual({ type: "say", text: "Chart added. Nice!" });
  });

  it("still refuses an unknown goal when vision isn't ready", () => {
    const t = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "add a chart" });
    expect(t.state).toMatchObject({ phase: "goal_entry", notice: COPY.noPack, open: false });
  });
});

describe("repeat and look again", () => {
  it("repeats the current instruction aloud", () => {
    const t = step(guiding(), { type: "REPEAT" });
    expect(t.effects).toEqual([{ type: "say", text: "Click Insert. I highlighted it." }]);
  });

  it("re-reads the screen on request, from guidance or after a failure", () => {
    const fromGuiding = step(guiding(), { type: "LOOK_AGAIN" });
    expect(fromGuiding.state.phase).toBe("observing");
    expect(types(fromGuiding)).toEqual(["cancelStuckTimer", "observe"]);
    const failed = step(reasoning(), { type: "PROVIDER_FAILED", requestId: 1, message: "boom" }).state;
    expect(step(failed, { type: "LOOK_AGAIN" }).state).toMatchObject({ phase: "observing", notice: undefined });
  });

  it("ignores both while idle", () => {
    expect(step(initialState, { type: "REPEAT" }).state).toBe(initialState);
    expect(step(initialState, { type: "LOOK_AGAIN" }).state).toBe(initialState);
  });
});
