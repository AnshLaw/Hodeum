import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { HodeMode, HodePlan, ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, el, obs } from "./test-fixtures";

/** An open goal is planned in the background once its first step is showing: the steps, a recap, and a check. */

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

const plans = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "planOpenGoal" }> => e.type === "planOpenGoal");
const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);
const reasonContexts = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "reason" }> => e.type === "reason").map((e) => e.context);

const GOAL = "send a message on discord";
const BOX = el("Message #general", "edit", { bounds: { x: 100, y: 500, width: 600, height: 40 } });
const SENT = el("hello there", "text", { bounds: { x: 100, y: 400, width: 200, height: 20 } });
const CHAT: ScreenObservation = { ...obs([BOX]), app: "Discord", windowTitle: "#general - Discord" };
/** The learner typed and sent: a new message on screen, after a click in the box. */
const TYPED: ScreenObservation = { ...obs([BOX, SENT]), app: "Discord", windowTitle: "#general - Discord", at: 1, inputs: [{ kind: "click", at: { x: 105, y: 505 }, button: "left" }] };
const PLAN: HodePlan = {
  concept: "A message goes to whichever channel or friend is open.",
  steps: [
    { objective: "Pick who to message", control: "Direct Messages", hint: "Where would your friends be listed?", why: "The message goes to the open conversation." },
    { objective: "Write the message", control: "Message #general", hint: "Where do you type?", why: "The box sends to this channel." },
  ],
  recap: "You picked a conversation, then typed and sent your message.",
  check: { question: "Where does a message go?", options: ["The open conversation", "Everyone"], answer: 0, explain: "Discord sends to whatever is open." },
};

const guide = (speech: string, kind: TeachingAction["kind"] = "guide"): TeachingAction => ({
  kind,
  speech,
  skill: "general.vision",
  assistanceLevel: "hint",
  target: { elementId: BOX.id, bounds: BOX.bounds, confidence: 0.9, label: BOX.name },
});

function begin(mode: HodeMode = "teach"): Transition {
  return play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: GOAL, openAllowed: true, mode }, { type: "OBSERVED", observation: CHAT });
}

function firstStep(mode: HodeMode = "teach"): Transition {
  const t = begin(mode);
  return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guide("Where would you type a message?"), failures: [] });
}

describe("planning an open Teach Hode", () => {
  it("asks for a plan once the first step is showing, so the first step isn't kept waiting", () => {
    expect(plans(begin())).toEqual([]);
    const t = firstStep();
    expect(plans(t)).toEqual([{ type: "planOpenGoal", planId: t.state.planId, goal: GOAL, language: "en" }]);
  });

  it("asks only once per Hode", () => {
    const t = firstStep();
    const acted = play(t.state, { type: "LEARNER_ACTED", observation: TYPED });
    expect(plans(play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Now press Enter."), failures: [] }))).toEqual([]);
  });

  it("doesn't plan a lesson, or a Hode outside Teach", () => {
    const lesson = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(plans(play(lesson.state, { type: "ACTION_READY", requestId: lesson.state.requestId, action: guide("Which tab adds things?"), failures: [] }))).toEqual([]);
    expect(plans(firstStep("help"))).toEqual([]);
  });

  it("keeps the plan, saying nothing, and the next look at the screen follows it", () => {
    const t = firstStep();
    const planned = play(t.state, { type: "PLAN_READY", planId: t.state.planId ?? -1, goal: GOAL, plan: PLAN });
    expect(planned.effects).toEqual([]);
    expect(planned.state.plan).toEqual(PLAN);
    const acted = play(planned.state, { type: "LEARNER_ACTED", observation: TYPED });
    expect(reasonContexts(acted).at(-1)?.plan).toEqual(PLAN.steps);
  });

  it("ignores a plan made for another Hode", () => {
    const t = firstStep();
    expect(play(t.state, { type: "PLAN_READY", planId: t.state.planId ?? -1, goal: "something else", plan: PLAN }).state.plan).toBeUndefined();
    expect(play(t.state, { type: "PLAN_READY", planId: (t.state.planId ?? 0) - 1, goal: GOAL, plan: PLAN }).state.plan).toBeUndefined();
  });

  it("closes with the plan's recap and checks the idea stuck", () => {
    const t = firstStep();
    const planned = play(t.state, { type: "PLAN_READY", planId: t.state.planId ?? -1, goal: GOAL, plan: PLAN });
    const acted = play(planned.state, { type: "LEARNER_ACTED", observation: TYPED });
    const done = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Sent!", "complete"), failures: [] });
    expect(done.state.phase).toBe("success");
    expect(said(done).at(-1)).toBe(`Sent! ${PLAN.recap} ${PLAN.check?.question}`);
    expect(done.state.review).toEqual({ check: PLAN.check });
    const answered = play(done.state, { type: "REVIEW_ANSWERED", option: 0 });
    expect(said(answered)).toEqual([`${EN.reviewRight[0]} ${PLAN.check?.explain}`]);
  });

  it("closes as before without a plan", () => {
    const t = firstStep();
    const acted = play(t.state, { type: "LEARNER_ACTED", observation: TYPED });
    const done = play(acted.state, { type: "ACTION_READY", requestId: acted.state.requestId, action: guide("Sent!", "complete"), failures: [] });
    expect(said(done).at(-1)).toBe("Sent!");
    expect(done.state.review).toBeUndefined();
  });
});
