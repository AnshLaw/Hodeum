import { describe, expect, it } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import { recordFor } from "../../data/recorder";
import { spoken } from "../../lib/spoken";
import type { ScreenObservation, TaskPack, TeachingAction } from "../../lib/types";
import { TASK_PACKS, matchGoal } from "../../task-packs";
import { finishedStep } from "../memory/summary";
import { optionSaid } from "./closing";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, el, guideAction, obs } from "./test-fixtures";

/** Regressions found in review: each test is one concrete sequence that used to go wrong. */

const EN = spoken("en");

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
const types = (t: Transition) => t.effects.map((e) => e.type);

const RECAP_PACK: TaskPack = { ...PACK, recap: "Insert, then PivotTable.", check: { question: "Which tab?", options: ["Insert", "Data", "Home"], answer: 0, explain: "Insert adds things." } };

function guiding(pack: TaskPack = PACK, mode: "teach" | "agent" = "teach"): HodeState {
  return play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "pivot", pack, mode },
    { type: "SKILL_LOADED", skillId: pack.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ assistanceLevel: mode === "agent" ? "demonstrate" : "hint", speech: "Which tab adds things?" }), failures: [] },
  ).state;
}

describe("open-ended steps in Hindi, and short instructions", () => {
  const FILE = el("File", "menu item");
  const acted: ScreenObservation = { ...obs([FILE, el("Save As", "menu item")]), app: "Word", at: 1, inputs: [{ kind: "click", at: { x: 5, y: 5 }, button: "left" }] };
  const guide = (speech: string, level: TeachingAction["assistanceLevel"] = "hint"): TeachingAction => ({ kind: "guide", speech, skill: "general.vision", assistanceLevel: level, target: { elementId: FILE.id, bounds: FILE.bounds, confidence: 0.9, label: "File" } });
  const openWith = (first: string): HodeState => {
    const t = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "save as pdf", openAllowed: true, mode: "teach" }, { type: "OBSERVED", observation: { ...obs([FILE]), app: "Word" } });
    return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guide(first), failures: [] }).state;
  };
  const next = (s: HodeState, speech: string) => {
    const a = play(s, { type: "LEARNER_ACTED", observation: acted });
    return play(a.state, { type: "ACTION_READY", requestId: a.state.requestId, action: guide(speech), failures: [] }).state;
  };

  it("doesn't count the same Hindi instruction as a new step", () => {
    const line = "फ़ाइल मेन्यू खोलिए।";
    expect(next(openWith(line), line).openDone ?? []).toEqual([]);
  });

  it("counts a different Hindi instruction as the next step", () => {
    expect(next(openWith("ऊपर बाईं ओर फ़ाइल मेन्यू खोलिए।"), "अब सेव ऐज़ चुनिए।").openDone).toHaveLength(1);
  });

  it("tells \"Click OK\" and \"Click Save\" apart", () => {
    expect(next(openWith("Click OK."), "Click Save.").openDone).toEqual(["Click OK."]);
  });
});

describe("spoken answers to the closing question", () => {
  const options = ["Right-click the files", "Double-click the files", "Press Delete"];

  it("reads ordinals right", () => {
    expect(optionSaid(options, "the second one")).toBe(1);
    expect(optionSaid(options, "the third one")).toBe(2);
    expect(optionSaid(options, "one")).toBe(0);
    expect(optionSaid(options, "the first")).toBe(0);
  });

  it("doesn't guess: \"this one\" or a tie is no answer", () => {
    expect(optionSaid(options, "this one")).toBeUndefined();
    expect(optionSaid(options, "click the files")).toBeUndefined();
  });

  it("isn't swayed by filler words", () => {
    expect(optionSaid(options, "delete the files")).toBe(2);
    expect(optionSaid(options, "right click")).toBe(0);
  });
});

describe("a reply from a Hode that's over", () => {
  it("can't land in the next Hode: request ids keep counting up across Hodes", () => {
    const first = guiding();
    const restarted = play(first, { type: "END_HODE" }, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(restarted.state.requestId).toBeGreaterThan(first.requestId);
    const late = play(restarted.state, { type: "ACTION_READY", requestId: first.requestId, action: guideAction({ speech: "from the old Hode" }), failures: [] });
    expect(late.state.phase).toBe("reasoning");
  });
});

describe("the closing question's card", () => {
  it("can be closed without answering", () => {
    const done = play(guiding(RECAP_PACK), { type: "LEARNER_ACTED", observation: INSERT_SELECTED }, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null });
    const last = play(done.state, { type: "ACTION_READY", requestId: done.state.requestId, action: guideAction({ assistanceLevel: "hint", speech: "Far left." }), failures: [] }, { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE });
    expect(last.state.review).toBeDefined();
    expect(notchView(last.state).controls).toContain("dismiss");
    expect(play(last.state, { type: "DISMISS" }).state.phase).toBe("idle");
  });
});

describe("\"I can't see that done yet\"", () => {
  it("isn't said in the next step once the learner finishes this one", () => {
    const looked = play(guiding(), { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 1 } });
    expect(looked.state.pendingNote).toBe(EN.cantSeeItDone);
    const done = play(looked.state, { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(done.state.pendingNote).toBeUndefined();
  });
});

describe("goals that should start their lesson", () => {
  it.each([
    ["make a pivot table showing sales by region", "excel-pivot"],
    ["turn on dark mode on my iPhone 15", "iphone-dark-mode"],
    ["compress my photos on windows", "windows-zip"],
    ["zip up this folder", "windows-zip"],
  ])("%j starts %s", (goal, id) => {
    expect(matchGoal(goal, TASK_PACKS)?.id).toBe(id);
  });

  it("still keeps a goal that only shares one word away", () => {
    expect(matchGoal("sort by zip code", TASK_PACKS)).toBeUndefined();
  });
});

describe("steps finished without a click", () => {
  it("are recorded in the learning history and in learning memory", () => {
    const looking = play(guiding(), { type: "LOOK_AGAIN" }).state;
    const event: HodeEvent = { type: "OBSERVED", observation: INSERT_SELECTED };
    const next = step(looking, event).state;
    expect(next.stepIndex).toBe(1);
    const ops = recordFor(event, looking, next, "hode-1", () => "x", "now");
    expect(ops).toContainEqual(expect.objectContaining({ op: "event", event: expect.objectContaining({ kind: "step_done" }) }));
    expect(finishedStep(event, looking, next)).toMatchObject({ skill: PACK.steps[0].skill, done: true });
  });

  it("but a skipped step isn't one the learner did", () => {
    const s = guiding();
    const next = step(s, { type: "SKIP_STEP" }).state;
    expect(finishedStep({ type: "SKIP_STEP" }, s, next)).toBeUndefined();
  });
});

describe("leaving a line half-said", () => {
  it("Skip and Practice stop Hodey mid-sentence", () => {
    expect(types(play(guiding(), { type: "SKIP_STEP" }))[0]).toBe("stopSpeech");
    const done = play(guiding(RECAP_PACK), { type: "LEARNER_ACTED", observation: INSERT_SELECTED }, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null });
    const last = play(done.state, { type: "ACTION_READY", requestId: done.state.requestId, action: guideAction({ assistanceLevel: "hint", speech: "Far left." }), failures: [] }, { type: "LEARNER_ACTED", observation: FIELDS_VISIBLE });
    expect(types(play(last.state, { type: "PRACTICE_AGAIN" }))[0]).toBe("stopSpeech");
  });
});

describe("pause", () => {
  it("brings the guidance back as it was, highlight and all", () => {
    const g = guiding(PACK, "agent");
    const resumed = play(g, { type: "PAUSE" }, { type: "RESUME" });
    expect(resumed.state).toMatchObject({ phase: "guiding", action: g.action });
    expect(types(resumed)).toContain("renderOverlay");
    expect(said(resumed)).toEqual([]);
  });

  it("survives a question asked while paused", () => {
    const g = guiding(PACK, "agent");
    const asked = play(g, { type: "PAUSE" }, { type: "VOICE_QUESTION", question: "what is this?" }, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = play(asked.state, { type: "ACTION_READY", requestId: asked.state.requestId, action: { kind: "answer", speech: "It's the ribbon.", skill: "general.vision", assistanceLevel: "demonstrate" }, failures: [] }, { type: "DISMISS" });
    expect(answered.state.phase).toBe("paused");
    expect(play(answered.state, { type: "RESUME" }).state).toMatchObject({ phase: "guiding", action: g.action });
  });
});
