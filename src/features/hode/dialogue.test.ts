import { describe, expect, it } from "vitest";
import type { TeachingAction } from "../../lib/types";
import { GeminiReasoningProvider } from "../../providers/cloud/gemini-reasoner";
import { DIALOGUE_TURNS, initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, PACK, guideAction } from "./test-fixtures";

/** The last few exchanges travel with each request, so "why?" or "and then?" can be answered in context. */

function play(state: HodeState, ...events: HodeEvent[]): Transition {
  return events.reduce<Transition>(
    (t, event) => {
      const next = step(t.state, event);
      return { state: next.state, effects: [...t.effects, ...next.effects] };
    },
    { state, effects: [] },
  );
}

const contexts = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "reason" }> => e.type === "reason").map((e) => e.context);

const guiding = (): HodeState =>
  play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "agent" },
    { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction({ speech: "Click Insert." }), failures: [] },
  ).state;

const answer = (speech: string): TeachingAction => ({ kind: "answer", speech, skill: "general.vision", assistanceLevel: "demonstrate" });

describe("the dialogue so far", () => {
  it("goes with a question: what Hodey last said, then what the learner asked", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "what does Insert do?" }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(contexts(asked)[0].history).toEqual([
      { who: "hodey", text: "Click Insert." },
      { who: "learner", text: "what does Insert do?" },
    ]);
  });

  it("includes Hodey's answer, so a follow-up question has its context", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "what does Insert do?" }, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = play(asked.state, { type: "ACTION_READY", requestId: asked.state.requestId, action: answer("It adds charts and tables."), failures: [] });
    const followUp = play(answered.state, { type: "VOICE_QUESTION", question: "why?" }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(contexts(followUp)[0].history?.slice(-3)).toEqual([
      { who: "learner", text: "what does Insert do?" },
      { who: "hodey", text: "It adds charts and tables." },
      { who: "learner", text: "why?" },
    ]);
  });

  it("never goes to the cloud: the learner's words stay on this PC", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "my salary sheet is private, right?" }, { type: "OBSERVED", observation: HOME_SELECTED });
    const answered = play(asked.state, { type: "ACTION_READY", requestId: asked.state.requestId, action: answer("Yes."), failures: [] }, { type: "DISMISS" });
    const next = play(answered.state, { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: HOME_SELECTED });
    const [context] = contexts(next);
    expect(context.history?.some((turn) => turn.text.includes("salary"))).toBe(true);
    const { request } = new GeminiReasoningProvider({ invoke: async () => undefined as never }).request(context);
    expect(JSON.stringify(request)).not.toContain("salary");
  });

  it("keeps only the last few turns, and starts empty in a new Hode", () => {
    let s = guiding();
    for (let i = 0; i < DIALOGUE_TURNS; i++) {
      const asked = play(s, { type: "VOICE_QUESTION", question: `question ${i}` }, { type: "OBSERVED", observation: HOME_SELECTED });
      s = play(asked.state, { type: "ACTION_READY", requestId: asked.state.requestId, action: answer(`answer ${i}`), failures: [] }, { type: "DISMISS" }).state;
    }
    expect(s.dialogue).toHaveLength(DIALOGUE_TURNS);
    expect(s.dialogue?.at(-1)).toEqual({ who: "hodey", text: `answer ${DIALOGUE_TURNS - 1}` });
    expect(play(s, { type: "END_HODE" }).state.dialogue).toBeUndefined();
  });
});
