import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import { spoken } from "../../lib/spoken";
import type { AssistanceLevel, HodeMode, ScreenObservation, SkillRecord } from "../../lib/types";
import { STUCK_MS, initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { acknowledgement } from "./learner";
import { step } from "./reducer";
import {
  DATA_SELECTED,
  FIELDS_VISIBLE,
  HOME_SELECTED,
  INSERT_BOUNDS,
  INSERT_SELECTED,
  PACK,
  annotation,
  el,
  guideAction,
  obs,
  skillRecord,
  tab,
} from "./test-fixtures";

function fold(state: HodeState, ...events: HodeEvent[]): Transition {
  let t: Transition = { state, effects: [] };
  for (const event of events) t = step(t.state, event);
  return t;
}

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);
/** Agent mode: every step guided, a new skill fully demonstrated (the original assistance ladder). */
const START: HodeEvent[] = [{ type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "teach me", pack: PACK, mode: "agent" }];

/** The mode whose range contains `level`: agent for full guidance, teach for the quieter levels. */
const modeFor = (level: AssistanceLevel) => (level === "demonstrate" || level === "guide" ? "agent" : "teach");

function reasoning(level: AssistanceLevel = "demonstrate"): HodeState {
  const record = level === "demonstrate" ? null : skillRecord(level);
  return fold(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "teach me", pack: PACK, mode: modeFor(level) },
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
    const begun = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "teach me", pack: PACK, mode: "teach" });
    expect(begun.state.phase).toBe("observing");
    expect(begun.effects).toEqual([
      { type: "focusApp", app: "Excel" },
      { type: "loadSkill", skillId: "excel.navigation.insert_tab" },
    ]);
    const loaded = step(begun.state, { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record: skillRecord("hint") });
    expect(loaded.state.level).toBe("hint");
    expect(types(loaded)).toEqual(["observe"]);
    const observed = step(loaded.state, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(observed.state).toMatchObject({ phase: "reasoning", requestId: 1 });
    expect(observed.effects[0]).toMatchObject({ type: "reason", requestId: 1, context: { step: { id: "open-insert" } } });
  });
});

describe("learning modes", () => {
  const startIn = (mode: HodeMode, record: SkillRecord | null = null) =>
    fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode }, { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record }).state;

  it("starts a new skill as a challenge in teach mode, silently in help mode, fully guided in agent mode", () => {
    expect(startIn("teach")).toMatchObject({ mode: "teach", level: "hint" });
    expect(startIn("help")).toMatchObject({ mode: "help", level: "observe" });
    expect(startIn("agent")).toMatchObject({ mode: "agent", level: "demonstrate" });
  });

  it("switching mode mid-step re-reasons at the new level", () => {
    const g = guiding("demonstrate");
    const t = step(g, { type: "SET_MODE", mode: "teach" });
    expect(t.state).toMatchObject({ mode: "teach", level: "hint", phase: "reasoning" });
    expect(types(t)).toEqual(["cancelStuckTimer", "reason"]);
  });

  it("switching mode while idle just remembers it", () => {
    const t = step(initialState, { type: "SET_MODE", mode: "help" });
    expect(t.state.mode).toBe("help");
    expect(t.effects).toEqual([]);
  });

  it("reveals the whole flow only when asked", () => {
    const g = startIn("teach");
    expect(g.showAllSteps).toBe(false);
    expect(step(g, { type: "SHOW_ALL_STEPS" }).state.showAllSteps).toBe(true);
  });
});

describe("staying in the right app", () => {
  const VS_CODE = { ...HOME_SELECTED, app: "VS Code", windowTitle: "notes.md - Visual Studio Code" };
  const loaded = () => fold(initialState, ...START, { type: "SKILL_LOADED", skillId: "excel.navigation.insert_tab", record: null }).state;

  it("asks the learner to switch instead of pointing into another app", () => {
    const t = step(loaded(), { type: "OBSERVED", observation: VS_CODE });
    expect(t.state).toMatchObject({ phase: "guiding", waitingForApp: "Excel", action: { kind: "clarify", speech: COPY.switchToApp("Excel") } });
    expect(t.state.action?.target).toBeUndefined();
    expect(types(t)).toEqual(["clearOverlay", "cancelStuckTimer", "say"]);
  });

  it("picks up as soon as the learner acts in the right app", () => {
    const waiting = step(loaded(), { type: "OBSERVED", observation: VS_CODE }).state;
    expect(step(waiting, { type: "LEARNER_ACTED", observation: VS_CODE }).effects).toEqual([]);
    const back = step(waiting, { type: "LEARNER_ACTED", observation: HOME_SELECTED });
    expect(back.state).toMatchObject({ phase: "reasoning", waitingForApp: undefined });
    expect(types(back)).toEqual(["reason"]);
  });

  it("keeps the waiting card, without repeating itself, when a fresh look still finds another app", () => {
    const waiting = step(loaded(), { type: "OBSERVED", observation: VS_CODE }).state;
    const looking = step(waiting, { type: "LOOK_AGAIN" }).state;
    const still = step(looking, { type: "OBSERVED", observation: VS_CODE });
    expect(still.state).toMatchObject({ phase: "guiding", waitingForApp: "Excel" });
    expect(still.effects).toEqual([]);
  });

  it("notices when the learner leaves the app mid-Hode", () => {
    const t = step(guiding(), { type: "LEARNER_ACTED", observation: VS_CODE });
    expect(t.state).toMatchObject({ waitingForApp: "Excel", action: { kind: "clarify" } });
  });
});

describe("opening the pack's app", () => {
  const LAUNCHING = { ...PACK, launch: { exe: "excel.exe", sample: "hodeum-sales.csv" } };

  it("opens the app with its practice file in Agent mode, so Hodey can get going", () => {
    const begun = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "teach me", pack: LAUNCHING, mode: "agent" });
    expect(begun.effects[0]).toEqual({ type: "focusApp", app: "Excel", launch: LAUNCHING.launch });
  });

  it("leaves opening it to the learner in Teach mode", () => {
    const begun = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "teach me", pack: LAUNCHING, mode: "teach" });
    expect(begun.effects[0]).toEqual({ type: "focusApp", app: "Excel" });
  });
});

describe("open-ended Hodes that name an app", () => {
  it("brings that app forward and won't plan in another one", () => {
    const begun = fold(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "add a table of contents in Word", openAllowed: true, app: "Word" });
    expect(begun.effects).toEqual([{ type: "focusApp", app: "Word" }, { type: "observe" }]);
    const t = step(begun.state, { type: "OBSERVED", observation: { ...HOME_SELECTED, app: "VS Code" } });
    expect(t.state).toMatchObject({ waitingForApp: "Word", action: { speech: COPY.switchToApp("Word") } });
  });
});

describe("spoken questions", () => {
  const answer = { kind: "answer" as const, speech: "That's the Insert tab.", skill: "general.vision", assistanceLevel: "demonstrate" as const };

  it("interrupts Hodey, drops stale reasoning, and looks at the screen", () => {
    const busy = reasoning();
    const t = step(busy, { type: "VOICE_QUESTION", question: "where is insert?" });
    expect(t.state).toMatchObject({ phase: "observing", spokenQuestion: "where is insert?", resumePhase: "observing" });
    expect(t.state.requestId).toBeGreaterThan(busy.requestId);
    expect(types(t)).toEqual(["stopSpeech", "cancelStuckTimer", "say", "observe"]);
    expect(COPY.acks).toContain((t.effects[2] as { text: string }).text);
  });

  it("answers about the whole screen, even from another app, then resumes the Hode", () => {
    const asked = step(guiding(), { type: "VOICE_QUESTION", question: "what is this?" }).state;
    const observed = step(asked, { type: "OBSERVED", observation: { ...HOME_SELECTED, app: "VS Code" } });
    expect(observed.effects[0]).toMatchObject({ type: "reason", context: { utterance: "what is this?" } });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: answer, failures: [] });
    expect(answered.state.phase).toBe("answering");
    const resumed = step(answered.state, { type: "DISMISS" });
    expect(resumed.state).toMatchObject({ phase: "guiding", spokenQuestion: undefined });
  });

  it("shows a reply phrased as guidance as the answer, so the question doesn't linger", () => {
    const asked = step(guiding(), { type: "VOICE_QUESTION", question: "how do I add a table?" }).state;
    const observed = step(asked, { type: "OBSERVED", observation: HOME_SELECTED });
    const reply = guideAction({ speech: "Open Insert first." });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: reply, failures: [] });
    expect(answered.state).toMatchObject({ phase: "answering", action: { kind: "answer", speech: "Open Insert first." } });
    expect(step(answered.state, { type: "DISMISS" }).state).toMatchObject({ phase: "guiding", spokenQuestion: undefined });
  });

  it("after Got it, brings back the step it interrupted without thinking or speaking again", () => {
    const before = guiding();
    const asked = step(before, { type: "VOICE_QUESTION", question: "what is this?" }).state;
    const observed = step(asked, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: answer, failures: [] });
    const resumed = step(answered.state, { type: "DISMISS" });
    expect(resumed.state).toMatchObject({ phase: "guiding", action: before.action, spokenQuestion: undefined });
    expect(types(resumed)).toEqual(["renderOverlay", "startStuckTimer"]);
  });

  it("keeps a paused Hode paused after a question", () => {
    const paused = step(guiding(), { type: "PAUSE" }).state;
    const asked = step(paused, { type: "VOICE_QUESTION", question: "what is this?" }).state;
    const observed = step(asked, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: answer, failures: [] });
    expect(step(answered.state, { type: "DISMISS" }).state).toMatchObject({ phase: "paused", pack: PACK });
  });

  it("notes when the answer has been said, and starts over when it's repeated", () => {
    const asked = step(initialState, { type: "VOICE_QUESTION", question: "what is this?" }).state;
    const observed = step(asked, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: answer, failures: [] });
    expect(answered.state.answerSaid).toBe(false);
    const said = step(answered.state, { type: "SPEECH_FINISHED" }).state;
    expect(said.answerSaid).toBe(true);
    expect(step(said, { type: "REPEAT" }).state.answerSaid).toBe(false);
  });

  it("works with no Hode running, and returns to idle", () => {
    const asked = step(initialState, { type: "VOICE_QUESTION", question: "what is this?" }).state;
    expect(asked).toMatchObject({ phase: "observing", resumePhase: "idle" });
    const observed = step(asked, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = step(observed.state, { type: "ACTION_READY", requestId: observed.state.requestId, action: answer, failures: [] });
    expect(step(answered.state, { type: "DISMISS" }).state.phase).toBe("idle");
  });

  it("returns to an open-ended Hode afterwards, not to idle", () => {
    const open: HodeState = { ...initialState, phase: "guiding", open: true, goal: "add a table of contents" };
    expect(step(open, { type: "VOICE_QUESTION", question: "what is this?" }).state.resumePhase).toBe("observing");
  });

  it("is ignored while the learner types a goal or marks the screen", () => {
    const entry = step(initialState, { type: "START_HODE" }).state;
    expect(step(entry, { type: "VOICE_QUESTION", question: "hi" }).state).toBe(entry);
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

  it("praises an unaided step, ahead of the next step's guidance", () => {
    const t = step(guiding("observe"), { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(t.state.pendingAck).toBe(COPY.rememberedOnYourOwn);
    const shown = step({ ...t.state, phase: "reasoning", requestId: 1 }, { type: "ACTION_READY", requestId: 1, action: guideAction({ speech: "Far left.", assistanceLevel: "observe" }), failures: [] });
    expect(shown.effects).toContainEqual({ type: "say", text: `${COPY.rememberedOnYourOwn} Far left.` });
    expect(shown.state).toMatchObject({ ack: COPY.rememberedOnYourOwn, pendingAck: undefined });
  });

  it("acknowledges every step done right in Teach, never with the same phrase twice running", () => {
    const say = spoken("en");
    const first = acknowledgement({ ...guiding("hint"), stepIndex: 0 });
    const second = acknowledgement({ ...guiding("hint"), stepIndex: 1, lastAck: first });
    expect(say.stepDone).toContain(first);
    expect(say.stepDone).toContain(second);
    expect(second).not.toBe(first);
    expect(acknowledgement({ ...guiding("observe"), lastAck: COPY.rememberedOnYourOwn })).not.toBe(COPY.rememberedOnYourOwn);
  });

  it("acknowledges in Help only when Hodey stepped in, and lightly in Agent", () => {
    const say = spoken("en");
    expect(acknowledgement({ ...guiding("observe"), mode: "help" })).toBeUndefined();
    expect(say.stepDone).toContain(acknowledgement({ ...guiding("hint"), mode: "help", escalated: true }));
    expect(say.stepDoneLight).toContain(acknowledgement(guiding("guide")));
  });

  it("clears the acknowledgement once the learner acts again", () => {
    const t = step({ ...guiding("hint"), ack: "Exactly right." }, { type: "LEARNER_ACTED", observation: HOME_SELECTED });
    expect(t.state.ack).toBeUndefined();
  });

  /** A click on the Home tab: a real action on another control, though the screen doesn't change. */
  const CLICKED_HOME: ScreenObservation = { ...HOME_SELECTED, inputs: [{ kind: "click", at: { x: 20, y: 10 }, button: "left" }] };

  it("escalates after repeated unrelated actions", () => {
    const once = step(guiding("hint"), { type: "LEARNER_ACTED", observation: CLICKED_HOME });
    expect(once.state.wrongActions).toBe(1);
    expect(once.effects).toEqual([]);
    const twice = step(once.state, { type: "LEARNER_ACTED", observation: CLICKED_HOME });
    expect(twice.state).toMatchObject({ level: "guide", wrongActions: 0, phase: "reasoning" });
  });

  it("re-reasons when the learner acts while reasoning is in flight", () => {
    const t = step(reasoning(), { type: "LEARNER_ACTED", observation: CLICKED_HOME });
    expect(t.state.requestId).toBe(2);
    expect(step(t.state, { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] }).state).toBe(t.state);
  });

  it("does nothing when an action changed nothing: no reasoning, no speech, no wrong action", () => {
    const t = step(guiding("hint"), { type: "LEARNER_ACTED", observation: { ...HOME_SELECTED, at: 5 } });
    expect(t.effects).toEqual([]);
    expect(t.state).toMatchObject({ phase: "guiding", wrongActions: 0, level: "hint" });
    // Still remembered, so stuck patterns (the target missing, an undo loop) can be spotted.
    expect(t.state.stepActions).toHaveLength(1);
    const noise = obs([...HOME_SELECTED.elements, el("Average: 4", "text", { bounds: { x: 0, y: 700, width: 80, height: 20 } })]);
    const twice = fold(guiding("hint"), { type: "LEARNER_ACTED", observation: noise }, { type: "LEARNER_ACTED", observation: noise });
    expect(twice.state).toMatchObject({ phase: "guiding", wrongActions: 0, level: "hint" });
  });

  it("keeps the reasoning in flight when the learner's action changed nothing", () => {
    const t = step(reasoning(), { type: "LEARNER_ACTED", observation: { ...HOME_SELECTED, at: 5 } });
    expect(t.state.requestId).toBe(1);
    expect(t.effects).toEqual([]);
    expect(step(t.state, { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] }).state.phase).toBe("guiding");
  });

  it("re-points when the step's target comes into view, without counting a wrong action or repeating itself", () => {
    const onPivotStep: HodeState = { ...guiding("guide"), stepIndex: 1, observation: HOME_SELECTED };
    const t = step(onPivotStep, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(t.state).toMatchObject({ phase: "reasoning", wrongActions: 0, level: "guide", escalated: false });
    const same = step(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guideAction({ speech: onPivotStep.action!.speech }), failures: [] });
    expect(types(same)).toEqual(["renderOverlay", "startStuckTimer"]);
    expect(same.state.repointing).toBe(false);
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
    expect(marking.state).toMatchObject({ phase: "annotating", resumePhase: "guiding" });
    expect(types(marking)).toEqual(["cancelStuckTimer", "stopSpeech"]);
    const cancelled = step(marking.state, { type: "ANNOTATE_CANCEL" });
    expect(cancelled.state.phase).toBe("guiding");
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
    expect(dismissed.state).toMatchObject({ phase: "guiding", question: undefined });
  });

  function answering(action = guideAction({ kind: "answer", speech: "That's Insert." })): Transition {
    const reasoned = fold(guiding(), { type: "ANNOTATE_START" }, { type: "ANNOTATION_SUBMITTED", annotation: ask }, { type: "OBSERVED", observation: HOME_SELECTED });
    return step(reasoned.state, { type: "ACTION_READY", requestId: reasoned.state.requestId, action, failures: [] });
  }

  it("rings the mark itself when the answer points at something far bigger (the whole page)", () => {
    const page = { x: 0, y: 0, width: 1600, height: 900 };
    const answered = answering(guideAction({ kind: "answer", speech: "That's the page.", target: { elementId: "pane:page", bounds: page, confidence: 0.9, label: "YouTube" } }));
    const render = answered.effects[0];
    expect(render).toMatchObject({ type: "renderOverlay", primitives: [{ kind: "highlight", bounds: INSERT_BOUNDS, emphasis: "precise" }] });
    expect(render.type === "renderOverlay" && render.primitives).toHaveLength(1);
    expect(answered.state.action?.target).toMatchObject({ bounds: INSERT_BOUNDS, label: "" });
  });

  it("clears the answer's marks once Hodey has said it, keeping the answer on the notch", () => {
    const said = step(answering().state, { type: "SPEECH_FINISHED" });
    expect(said.state.phase).toBe("answering");
    expect(said.effects).toEqual([{ type: "clearOverlay" }]);
  });

  it("ignores a line finishing outside an answer", () => {
    const state = guiding();
    expect(step(state, { type: "SPEECH_FINISHED" }).state).toBe(state);
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

describe("richer stuck detection (PRD §7)", () => {
  const act = (observation: ScreenObservation): HodeEvent => ({ type: "LEARNER_ACTED", observation });
  const say = spoken("en");
  const clickHome: ScreenObservation = { ...HOME_SELECTED, inputs: [{ kind: "click", at: { x: 20, y: 10 }, button: "left" }] };
  const undo: ScreenObservation = { ...HOME_SELECTED, inputs: [{ kind: "undo" }] };
  const reasonedWith = (t: Transition) => t.effects.find((e) => e.type === "reason");

  it("a third click on the same wrong control raises help and points at the right one", () => {
    const t = fold(guiding("hint"), act(clickHome), act(clickHome), act(clickHome));
    expect(t.state).toMatchObject({ phase: "reasoning", level: "demonstrate", stuck: { kind: "repeated_click", control: "Home" } });
    expect(t.effects[0]).toEqual({ type: "cancelStuckTimer" });
    expect(reasonedWith(t)).toMatchObject({ context: { correction: say.repeatedClick("Home") } });
  });

  it("opening, closing and reopening the same wrong menu raises help", () => {
    const menu = obs([...HOME_SELECTED.elements, el("See more", "menu", { bounds: { x: 300, y: 40, width: 120, height: 200 } })]);
    const t = fold(guiding("hint"), act(menu), act(HOME_SELECTED), act(menu));
    expect(t.state).toMatchObject({ level: "demonstrate", stuck: { kind: "menu_loop", menu: "See more" } });
    expect(reasonedWith(t)).toMatchObject({ context: { correction: say.menuLoop("See more") } });
  });

  it("two undos in a row raise help without counting as a mistake", () => {
    const t = fold(guiding("hint"), act(undo), act(undo));
    expect(t.state).toMatchObject({ level: "guide", mistakes: 0, escalated: true, stuck: { kind: "undo_loop" } });
    expect(reasonedWith(t)).toMatchObject({ context: { correction: say.undoLoop } });
  });

  it("the expected control still missing after a few actions raises help", () => {
    const noInsert = obs([tab("Home", 0, true)]);
    const t = fold(guiding("hint"), act(noInsert), act(noInsert), act(noInsert));
    expect(t.state.stuck).toEqual({ kind: "target_missing", target: "Insert" });
    expect(reasonedWith(t)).toMatchObject({ context: { correction: say.targetMissing("Insert") } });
  });

  it("a surprise dialog gets a recovery line, and guidance resumes once it's closed", () => {
    const dialog = obs([...HOME_SELECTED.elements, el("Microsoft Excel", "dialog")]);
    const shown = step(guiding("hint"), act(dialog));
    const line = say.surpriseDialog("Microsoft Excel");
    expect(shown.state).toMatchObject({ phase: "guiding", level: "hint", surprise: "Microsoft Excel", action: { kind: "correct", speech: line } });
    expect(shown.effects).toEqual([{ type: "cancelStuckTimer" }, { type: "clearOverlay" }, { type: "say", text: line }, { type: "startStuckTimer", ms: STUCK_MS }]);
    const stillOpen = step(shown.state, act(dialog));
    expect(stillOpen.effects).toEqual([]);
    const closed = step(stillOpen.state, act(HOME_SELECTED));
    expect(closed.state).toMatchObject({ phase: "reasoning", surprise: undefined, level: "hint" });
  });

  it("starts each step with a clean history", () => {
    const t = fold(guiding("hint"), act(clickHome), act(INSERT_SELECTED));
    expect(t.state).toMatchObject({ stepIndex: 1, stepActions: [], stuck: undefined });
  });

  it("leaves phone Hodes to the stuck timer (their screen changes are navigation)", () => {
    const phone = { ...guiding("hint"), pack: { ...PACK, surface: "phone" as const } };
    const noInsert = obs([tab("Home", 0, true)]);
    expect(fold(phone, act(noInsert), act(noInsert), act(noInsert)).state.stuck).toBeUndefined();
  });

  it("'where is it?' raises help like the stuck timer, never pausing", () => {
    const t = step(guiding("hint"), { type: "SAID_STUCK" });
    expect(t.state).toMatchObject({ phase: "reasoning", level: "guide", escalated: true, mistakes: 0, stuck: { kind: "said_stuck" } });
    expect(types(t)).toEqual(["cancelStuckTimer", "reason"]);
    expect(step(reasoning(), { type: "SAID_STUCK" }).state.phase).toBe("reasoning");
  });

  it("past the most help, explains why and resets the step (the last rung of the ladder)", () => {
    const t = step(guiding("demonstrate"), { type: "STUCK_TIMEOUT" });
    expect(reasonedWith(t)).toMatchObject({ context: { assistanceLevel: "demonstrate", correction: "Insert adds things. Click Insert. I highlighted it." } });
  });

  it("after that reset, waits for the learner instead of re-deciding on every timeout", () => {
    const reset = fold(guiding("demonstrate"), { type: "STUCK_TIMEOUT" }, { type: "ACTION_READY", requestId: 2, action: guideAction(), failures: [] }).state;
    expect(reset.phase).toBe("guiding");
    expect(step(reset, { type: "STUCK_TIMEOUT" }).state).toBe(reset);
    // Looking around changes nothing; a real action makes the reset available again.
    const lookedAround = step(reset, act({ ...HOME_SELECTED, at: 9 })).state;
    expect(step(lookedAround, { type: "STUCK_TIMEOUT" }).state).toBe(lookedAround);
    const menu = obs([...HOME_SELECTED.elements, el("See more", "menu", { bounds: { x: 300, y: 40, width: 120, height: 200 } })]);
    const acted = step(reset, act(menu)).state;
    const settled = step(acted, { type: "ACTION_READY", requestId: acted.requestId, action: guideAction(), failures: [] }).state;
    expect(step(settled, { type: "STUCK_TIMEOUT" }).state.phase).toBe("reasoning");
  });
});

describe("a learner who acts before Hodey is ready", () => {
  const at = (observation: typeof HOME_SELECTED, time: number) => ({ ...observation, at: time });
  /** Insert done by the learner: the next step (click-pivot) is being prepared. */
  function preparingNextStep(): HodeState {
    return step(guiding(), { type: "LEARNER_ACTED", observation: at(INSERT_SELECTED, 1) }).state;
  }

  it("keeps a click made while the next step loads, and counts it when the screen is read", () => {
    const preparing = preparingNextStep();
    expect(preparing.phase).toBe("observing");
    const clicked = step(preparing, { type: "LEARNER_ACTED", observation: at(FIELDS_VISIBLE, 3) }).state;
    const loaded = step(clicked, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null }).state;
    // The screen read started before the click finished: its observation is older than the click's.
    const done = step(loaded, { type: "OBSERVED", observation: at(INSERT_SELECTED, 2) });
    expect(done.state.phase).toBe("success");
    expect(done.state.learnedSkills).toContain(PACK.steps[1].skill);
  });

  it("never credits a step that was already done with no learner action: Hodey still teaches it", () => {
    const loaded = step(preparingNextStep(), { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null }).state;
    const t = step(loaded, { type: "OBSERVED", observation: at(FIELDS_VISIBLE, 2) });
    expect(t.state.phase).toBe("reasoning");
    expect(t.state.learnedSkills).not.toContain(PACK.steps[1].skill);
  });

  it("counts a click the screen read already shows, when it came in while preparing", () => {
    const clicked = step(preparingNextStep(), { type: "LEARNER_ACTED", observation: at(FIELDS_VISIBLE, 2) }).state;
    const loaded = step(clicked, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null }).state;
    expect(step(loaded, { type: "OBSERVED", observation: at(FIELDS_VISIBLE, 3) }).state.phase).toBe("success");
  });

  it("still reasons as usual when the step isn't done yet", () => {
    const loaded = step(preparingNextStep(), { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null }).state;
    expect(step(loaded, { type: "OBSERVED", observation: at(INSERT_SELECTED, 2) }).state.phase).toBe("reasoning");
  });
});
