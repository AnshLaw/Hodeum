import { describe, expect, it, vi } from "vitest";
import { COPY } from "../lib/copy";
import type { TeachingContext } from "../lib/types";
import { HOME_SELECTED, INSERT_BOUNDS, PACK, annotation, el, obs, tab } from "../features/hode/test-fixtures";
import type { ReasoningProvider } from "./interfaces";
import { MemorySkillStore } from "./memory-skill-store";
import { reasonWithFallback } from "./router";
import { TaskPackReasoningProvider } from "./task-pack-reasoner";

const reasoner = new TaskPackReasoningProvider();
const ctx = (overrides: Partial<TeachingContext> = {}): TeachingContext => ({
  goal: "pivot",
  pack: PACK,
  step: PACK.steps[0],
  observation: HOME_SELECTED,
  assistanceLevel: "demonstrate",
  recentMistakes: 0,
  ...overrides,
});

describe("TaskPackReasoningProvider", () => {
  it("guides to the step target with speech for the current level", async () => {
    const action = await reasoner.reason(ctx({ assistanceLevel: "guide" }));
    expect(action).toMatchObject({ kind: "guide", speech: "Open Insert.", target: { label: "Insert", confidence: 0.95, bounds: INSERT_BOUNDS } });
  });

  it("returns a correction when the context carries one", async () => {
    const action = await reasoner.reason(ctx({ correction: "You opened Data." }));
    expect(action).toMatchObject({ kind: "correct", speech: "You opened Data." });
  });

  it("lowers confidence when only the name matches, not the role", async () => {
    const action = await reasoner.reason(ctx({ observation: obs([el("Insert", "button")]) }));
    expect(action.target?.confidence).toBeCloseTo(0.76);
  });

  it("asks for clarification when the target is missing", async () => {
    const action = await reasoner.reason(ctx({ observation: obs([tab("Home", 0)]) }));
    expect(action).toMatchObject({ kind: "clarify", speech: COPY.clarify });
    expect(action.target).toBeUndefined();
  });

  it("prefers the candidate inside the learner's focus region", async () => {
    const far = { x: 500, y: 0, width: 40, height: 20 };
    const observation = obs([tab("Insert", 1), el("Insert", "tab item", { id: "insert-2", bounds: far })]);
    const action = await reasoner.reason(ctx({ observation, focusRegion: annotation("focus", { x: 490, y: -10, width: 80, height: 40 }) }));
    expect(action.target?.elementId).toBe("insert-2");
  });

  it("answers a Point & Ask question with the pack's explanation", async () => {
    const action = await reasoner.reason(ctx({ focusRegion: annotation("ask", { x: 45, y: -5, width: 50, height: 30 }, "What is this?") }));
    expect(action.kind).toBe("answer");
    expect(action.speech).toBe("That's Insert. Insert adds things. It's the one you need for this step.");
  });

  it("describes an unknown control by name and role", async () => {
    const action = await reasoner.reason(ctx({ focusRegion: annotation("ask", { x: 95, y: -5, width: 50, height: 30 }, "What is this?") }));
    expect(action.speech).toBe('That\'s the "Data" tab item.');
  });

  it("says so when nothing is inside the region", async () => {
    const action = await reasoner.reason(ctx({ focusRegion: annotation("ask", { x: 900, y: 900, width: 10, height: 10 }, "?") }));
    expect(action).toMatchObject({ kind: "answer", speech: COPY.nothingMarked });
  });

  it("throws when there is neither a step nor a question", async () => {
    await expect(reasoner.reason(ctx({ step: undefined }))).rejects.toThrow(/No task step/);
  });
});

describe("reasonWithFallback", () => {
  const failing: ReasoningProvider = { id: "gemini", reason: async () => Promise.reject(new Error("quota")), healthCheck: async () => false };

  it("falls back to the next provider and reports the failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const routed = await reasonWithFallback([failing, reasoner], ctx());
    expect(routed.failures).toEqual(["gemini: quota"]);
    expect(routed.action.kind).toBe("guide");
  });

  it("throws when every provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(reasonWithFallback([failing], ctx())).rejects.toThrow(/All reasoning providers failed — gemini: quota/);
  });
});

describe("MemorySkillStore", () => {
  it("persists outcomes and relaxes after an unaided step", async () => {
    const store = new MemorySkillStore(() => "now");
    expect(await store.get("s.a")).toBeNull();
    await store.recordOutcome("s.a", { completed: true, mistakes: 0, level: "demonstrate", escalated: false });
    expect(await store.get("s.a")).toMatchObject({ last_assistance_level: "guide", success_count: 1, last_seen_at: "now" });
  });
});
