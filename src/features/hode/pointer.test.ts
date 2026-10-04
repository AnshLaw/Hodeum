import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import type { TeachingContext } from "../../lib/types";
import { buildMessages, selectCandidates } from "../../providers/vision/prompt";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HOME_SELECTED, INSERT_BOUNDS, PACK, el, guideAction, obs } from "./test-fixtures";

/** "Move your pointer near the area you're working in": Hodey asks once, then the pointer answers. */

function play(state: HodeState, ...events: HodeEvent[]): Transition {
  return events.reduce<Transition>(
    (t, event) => {
      const next = step(t.state, event);
      return { state: next.state, effects: [...t.effects, ...next.effects] };
    },
    { state, effects: [] },
  );
}

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);
const said = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "say" }> => e.type === "say").map((e) => e.text);
const UNSURE = guideAction({ assistanceLevel: "guide", target: { elementId: "x", bounds: INSERT_BOUNDS, confidence: 0.3, label: "Insert" } });

/** A lesson step where the model can't tell which control is meant, twice: Hodey asks where the learner is working. */
function clarifying(): Transition {
  const t = play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" },
    { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
  );
  return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: UNSURE, failures: [] }, { type: "OBSERVED", observation: HOME_SELECTED });
}

describe("asking where the learner is working", () => {
  it("asks, and watches the pointer for the answer", () => {
    const t = clarifying();
    expect(t.state.action?.kind).toBe("clarify");
    expect(said(t)).toContain(COPY.clarify);
    expect(types(t)).toContain("watchPointer");
  });

  it("asks only once: still unsure later, it waits quietly for the pointer", () => {
    const t = clarifying();
    const raised = play(t.state, { type: "STUCK_TIMEOUT" });
    const again = play(raised.state, { type: "ACTION_READY", requestId: raised.state.requestId, action: UNSURE, failures: [] }, { type: "OBSERVED", observation: HOME_SELECTED });
    expect(again.state.action?.kind).toBe("clarify");
    expect(said(again)).not.toContain(COPY.clarify);
  });

  it("looks again once the pointer comes to rest somewhere new", () => {
    const rested = play(clarifying().state, { type: "POINTER_RESTED" });
    expect(rested.state.phase).toBe("observing");
    expect(types(rested)).toEqual(["cancelStuckTimer", "observe"]);
  });

  it("ignores a resting pointer when it isn't asking", () => {
    const t = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "teach" }, { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null }, { type: "OBSERVED", observation: HOME_SELECTED });
    const guided = play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: guideAction({ assistanceLevel: "guide" }), failures: [] });
    expect(play(guided.state, { type: "POINTER_RESTED" }).effects).toEqual([]);
  });
});

describe("the pointer in the model's prompt", () => {
  const FAR = el("Bold", "button", { bounds: { x: 0, y: 0, width: 40, height: 20 } });
  const NEAR = el("Send", "button", { bounds: { x: 500, y: 500, width: 60, height: 24 } });
  const ctx = (pointer?: { x: number; y: number }): TeachingContext => ({ goal: "finish the post", observation: obs([FAR, NEAR]), assistanceLevel: "guide", recentMistakes: 0, openGoal: true, pointer });

  it("ranks the controls by the pointer first", () => {
    expect(selectCandidates(ctx()).map((e) => e.name)).toEqual(["Bold", "Send"]);
    expect(selectCandidates(ctx({ x: 520, y: 510 })).map((e) => e.name)).toEqual(["Send", "Bold"]);
  });

  it("leaves the pointer out of a phone Hode: the desktop pointer isn't on the phone's screen", () => {
    expect(selectCandidates({ ...ctx({ x: 520, y: 510 }), pack: { ...PACK, surface: "phone" } }).map((e) => e.name)).toEqual(["Bold", "Send"]);
  });

  it("tells the model where the pointer rests", () => {
    const [, user] = buildMessages(ctx({ x: 400, y: 300 }), [], { png: "", rect: { x: 0, y: 0, width: 800, height: 600 } });
    const text = (user.content as Array<{ type: string; text?: string }>).map((part) => part.text ?? "").join("\n");
    expect(text).toContain("The learner's pointer is at [500, 500]");
  });
});
