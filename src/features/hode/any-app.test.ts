import { describe, expect, it } from "vitest";
import { spoken } from "../../lib/spoken";
import type { Rect, ScreenObservation, TeachingAction } from "../../lib/types";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { REGION_PADDING_PX } from "./region";
import { el, obs } from "./test-fixtures";

/** Teaching in any app ("how do I send a message on Discord?"): point the way, say how to get there, look things up only when needed. */

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
const overlays = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "renderOverlay" }> => e.type === "renderOverlay").map((e) => e.primitives);
const contexts = (t: Transition) => t.effects.filter((e): e is Extract<HodeEffect, { type: "reason" }> => e.type === "reason").map((e) => e.context);

const WINDOW: Rect = { x: 0, y: 0, width: 1600, height: 900 };
const MESSAGE_BOX = el("Message #general", "edit", { bounds: { x: 300, y: 820, width: 1000, height: 44 } });
const DISCORD: ScreenObservation = { ...obs([MESSAGE_BOX]), app: "Discord", windowTitle: "#general - Discord", window: { id: 7, bounds: WINDOW } };
const BROWSER: ScreenObservation = { ...obs([el("Address bar", "edit")]), app: "Chrome", windowTitle: "New Tab - Google Chrome" };

const hint = (speech: string): TeachingAction => ({ kind: "guide", speech, skill: "general.vision", assistanceLevel: "hint", target: { elementId: MESSAGE_BOX.id, bounds: MESSAGE_BOX.bounds, confidence: 0.9, label: MESSAGE_BOX.name } });

function openGoal(app?: string): Transition {
  return play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "how do I send a message on discord", openAllowed: true, app, mode: "teach" });
}

describe("a hint about a control that stands alone", () => {
  it("still lights up where to look: a generous area around it, inside the window", () => {
    const t = play(openGoal("Discord").state, { type: "OBSERVED", observation: DISCORD });
    const shown = play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: hint("Where would you type a message?"), failures: [] });
    const [primitives] = overlays(shown);
    expect(primitives).toHaveLength(1);
    const area = primitives[0];
    expect(area).toMatchObject({ kind: "highlight", emphasis: "broad" });
    expect(area.kind === "highlight" && area.label).toBeFalsy();
    if (area.kind !== "highlight") throw new Error("expected a highlight");
    // Bigger than the box itself (it hints, it doesn't pinpoint), and never outside the window.
    expect(area.bounds.width).toBeGreaterThan(MESSAGE_BOX.bounds.width + 2 * REGION_PADDING_PX);
    expect(area.bounds.y + area.bounds.height).toBeLessThanOrEqual(WINDOW.y + WINDOW.height);
  });
});

describe("an app that isn't open yet", () => {
  it("is opened the way any app is: Windows key, its name, Enter", () => {
    const waiting = play(openGoal("Discord").state, { type: "OBSERVED", observation: BROWSER }, { type: "SHELL_OBSERVED", elements: [] });
    expect(said(waiting)).toEqual([EN.howToOpen("Discord")]);
    expect(waiting.state).toMatchObject({ phase: "guiding", waitingForApp: "Discord" });
  });
});

describe("looking things up", () => {
  const guiding = (): HodeState => {
    const t = play(openGoal("Discord").state, { type: "OBSERVED", observation: DISCORD });
    return play(t.state, { type: "ACTION_READY", requestId: t.state.requestId, action: hint("Where would you type a message?"), failures: [] }).state;
  };

  it("doesn't happen for an ordinary question: the screen answers first", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "what is this channel for?" }, { type: "OBSERVED", observation: DISCORD });
    expect(contexts(asked)[0].lookUp).toBeFalsy();
  });

  it("happens when the learner asks Hodey to look it up", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "how do I add an emoji?", lookUp: true }, { type: "OBSERVED", observation: DISCORD });
    expect(contexts(asked)[0].lookUp).toBe(true);
  });

  it("happens once, when the screen-first answer can't point at anything", () => {
    const asked = play(guiding(), { type: "VOICE_QUESTION", question: "how do I start a voice call?" }, { type: "OBSERVED", observation: DISCORD });
    const unsure: TeachingAction = { kind: "clarify", speech: "Which call do you mean?", skill: "general.vision", assistanceLevel: "hint" };
    const retried = play(asked.state, { type: "ACTION_READY", requestId: asked.state.requestId, action: unsure, failures: [] });
    expect(contexts(retried)).toHaveLength(1);
    expect(contexts(retried)[0]).toMatchObject({ lookUp: true, utterance: "how do I start a voice call?" });
    const stillUnsure = play(retried.state, { type: "ACTION_READY", requestId: retried.state.requestId, action: unsure, failures: [] });
    expect(stillUnsure.state.phase).toBe("answering");
    expect(said(stillUnsure)).toEqual(["Which call do you mean?"]);
  });
});
