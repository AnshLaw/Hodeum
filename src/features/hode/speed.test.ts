import { describe, expect, it, vi } from "vitest";
import { notchView } from "../../components/notch/notch-view";
import { LocalBus } from "../../lib/bus";
import { spoken } from "../../lib/spoken";
import type { TeachingAction, TeachingContext } from "../../lib/types";
import type { PerceptionAdapter, ReasoningHooks, ReasoningProvider, TTSProvider } from "../../providers/interfaces";
import { GroundedPlannerProvider } from "../../providers/local-reasoner";
import { MemorySkillStore } from "../../providers/memory-skill-store";
import { reasonWithFallback } from "../../providers/router";
import { TaskPackReasoningProvider } from "../../providers/task-pack-reasoner";
import { initialState, type HodeEffect, type HodeEvent, type HodeState, type Transition } from "./model";
import { step } from "./reducer";
import { HodeRuntime } from "./runtime";
import { FIELDS_VISIBLE, HOME_SELECTED, INSERT_SELECTED, PACK, el, guideAction, obs } from "./test-fixtures";

/** Hodey answers as fast as it can without guessing: no read, model call or line it doesn't need. */

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

const types = (t: Transition): HodeEffect["type"][] => t.effects.map((e) => e.type);

function guidingFirstStep(): HodeState {
  return play(
    initialState,
    { type: "START_HODE" },
    { type: "GOAL_SUBMITTED", goal: "make a pivot table", pack: PACK, mode: "agent" },
    { type: "SKILL_LOADED", skillId: PACK.steps[0].skill, record: null },
    { type: "OBSERVED", observation: HOME_SELECTED },
    { type: "ACTION_READY", requestId: 1, action: guideAction(), failures: [] },
  ).state;
}

describe("the next step starts from the screen read that finished the last one", () => {
  it("reasons straight away when the next step's control is already in that read", () => {
    const done = play(guidingFirstStep(), { type: "LEARNER_ACTED", observation: INSERT_SELECTED });
    expect(done.state).toMatchObject({ stepIndex: 1, phase: "observing" });
    const loaded = play(done.state, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null });
    expect(types(loaded)).toEqual(["reason"]);
    expect(loaded.effects[0]).toMatchObject({ context: { observation: INSERT_SELECTED, step: { id: "click-pivot" } } });
  });

  it("reads the screen again when that read doesn't show the next step's control yet", () => {
    const withoutPivot = { ...INSERT_SELECTED, elements: INSERT_SELECTED.elements.filter((e) => e.name !== "PivotTable") };
    const done = play(guidingFirstStep(), { type: "LEARNER_ACTED", observation: withoutPivot });
    expect(types(play(done.state, { type: "SKILL_LOADED", skillId: PACK.steps[1].skill, record: null }))).toEqual(["observe"]);
  });
});

describe("an unsure answer", () => {
  const unsure = guideAction({ target: { elementId: "x", bounds: { x: 0, y: 0, width: 10, height: 10 }, confidence: 0.3, label: "?" } });

  it("looks once more, but doesn't ask again about a screen that hasn't changed", () => {
    const looked = play(guidingFirstStep(), { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 1 } });
    const unsureOnce = play(looked.state, { type: "ACTION_READY", requestId: looked.state.requestId, action: unsure, failures: [] });
    expect(types(unsureOnce)).toEqual(["observe"]);
    const same = play(unsureOnce.state, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 2 } });
    expect(types(same)).not.toContain("reason");
    expect(same.state).toMatchObject({ phase: "guiding", action: { kind: "clarify", speech: EN.clarify } });
  });

  it("asks again once the screen did change", () => {
    const looked = play(guidingFirstStep(), { type: "LOOK_AGAIN" }, { type: "OBSERVED", observation: { ...HOME_SELECTED, at: 1 } });
    const unsureOnce = play(looked.state, { type: "ACTION_READY", requestId: looked.state.requestId, action: unsure, failures: [] });
    expect(types(play(unsureOnce.state, { type: "OBSERVED", observation: { ...FIELDS_VISIBLE, at: 2 } }))).toContain("reason");
  });

  it("in an open-ended Hode, still says the model's own line, just without a highlight", () => {
    const open = play(initialState, { type: "START_HODE" }, { type: "GOAL_SUBMITTED", goal: "rename this file", openAllowed: true, mode: "teach" }, { type: "OBSERVED", observation: obs([el("File", "menu item")]) });
    const line = "Press F2 to rename the selected file.";
    const t = play(open.state, { type: "ACTION_READY", requestId: 1, action: { ...unsure, speech: line, assistanceLevel: "hint" }, failures: [] });
    expect(t.state).toMatchObject({ phase: "guiding", action: { speech: line } });
    expect(t.state.action?.target).toBeUndefined();
    expect(t.effects).toContainEqual({ type: "say", text: line });
  });
});

describe("guidance stays up while Hodey re-checks in the background", () => {
  it("keeps the card (marked busy) during an unprompted slow re-check, and shows the looking orb when the learner asked", () => {
    const g = guidingFirstStep();
    const rechecking: HodeState = { ...g, phase: "reasoning", requestId: g.requestId + 1, thinking: true };
    expect(notchView(rechecking)).toMatchObject({ mode: "guidance", busy: true });
    expect(notchView({ ...rechecking, prompted: true }).mode).toBe("status");
  });
});

describe("the local planner answers a lesson step before any slower reasoner", () => {
  const ctx = (overrides: Partial<TeachingContext> = {}): TeachingContext => ({ goal: "pivot", pack: PACK, step: PACK.steps[0], observation: HOME_SELECTED, assistanceLevel: "guide", recentMistakes: 0, ...overrides });
  const slow = (): ReasoningProvider & { calls: number } => {
    const provider = {
      id: "slow",
      calls: 0,
      async reason(): Promise<TeachingAction> {
        provider.calls += 1;
        return guideAction({ speech: "from the slow reasoner" });
      },
      healthCheck: async () => true,
    };
    return provider;
  };

  it("doesn't wait on the cloud or the vision model for a step UI Automation can ground", async () => {
    const cloud = slow();
    const { action, failures } = await reasonWithFallback([new GroundedPlannerProvider(new TaskPackReasoningProvider()), cloud], ctx());
    expect(action).toMatchObject({ kind: "guide", speech: "Open Insert." });
    expect(cloud.calls).toBe(0);
    expect(failures).toEqual([]);
  });

  it("steps aside, without counting as a failure, when it can't find the control or there's a question", async () => {
    const cloud = slow();
    const missing = await reasonWithFallback([new GroundedPlannerProvider(new TaskPackReasoningProvider()), cloud], ctx({ observation: obs([]) }));
    const asked = await reasonWithFallback([new GroundedPlannerProvider(new TaskPackReasoningProvider()), cloud], ctx({ utterance: "what does Data do?" }));
    expect([missing.action.speech, asked.action.speech]).toEqual(["from the slow reasoner", "from the slow reasoner"]);
    expect([...missing.failures, ...asked.failures]).toEqual([]);
  });
});

describe("a newer request cancels the reasoning still running for an older one", () => {
  it("aborts the old request's signal and never reports its result", async () => {
    const signals: AbortSignal[] = [];
    const never: ReasoningProvider = {
      id: "hangs",
      reason: (_context: TeachingContext, hooks?: ReasoningHooks) =>
        new Promise<TeachingAction>((_, reject) => {
          if (hooks?.signal) signals.push(hooks.signal);
          hooks?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      healthCheck: async () => true,
    };
    const perception: PerceptionAdapter = { observe: vi.fn(async () => HOME_SELECTED), onLearnerAction: () => () => undefined } as unknown as PerceptionAdapter;
    const tts: TTSProvider = { speak: async () => undefined, stop: async () => undefined, healthCheck: async () => true };
    const runtime = new HodeRuntime({ perception, reasoners: [never], skills: new MemorySkillStore(), bus: new LocalBus(), tts });
    runtime.dispatch({ type: "START_HODE" });
    runtime.dispatch({ type: "GOAL_SUBMITTED", goal: "pivot", pack: PACK, mode: "agent" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    runtime.dispatch({ type: "PAUSE" });
    expect(signals[0].aborted).toBe(true);
    await Promise.resolve();
    expect(runtime.getState().phase).toBe("paused");
  });
});
