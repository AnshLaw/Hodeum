import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_SELECTED, INSERT_BOUNDS, PACK, annotation, el, obs } from "../../features/hode/test-fixtures";
import type { TeachingContext } from "../../lib/types";
import { CloudSkipped } from "./gated";
import { GeminiReasoningProvider, MAX_GEMINI_ELEMENTS, buildGeminiRequest } from "./gemini-reasoner";

const ctx = (overrides: Partial<TeachingContext> = {}): TeachingContext => ({
  goal: "make a pivot table",
  pack: PACK,
  step: PACK.steps[0],
  observation: HOME_SELECTED,
  assistanceLevel: "guide",
  recentMistakes: 0,
  ...overrides,
});

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function bridge(reply: unknown) {
  const invoke = vi.fn(async (command: string) => (command === "gemini_reason" ? reply : { gemini: true, elevenlabs: false, backboard: false }));
  return { invoke: invoke as unknown as Invoke & typeof invoke };
}

/** The step targets Insert, so it ranks first among the listed controls. */
const POINT_AT_INSERT = { kind: "guide", speech: "Open the Insert tab.", target_index: 0, confidence: 0.9 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildGeminiRequest", () => {
  it("sends the step, the skill and the on-screen controls as text", () => {
    const { prompt, system } = buildGeminiRequest(ctx({ language: "hi" }), HOME_SELECTED.elements);
    expect(system).toMatch(/never do the task/i);
    for (const text of ["make a pivot table", "Test", "Open the Insert tab", "excel.navigation.insert_tab", "guide", "Insert", "tab item:Insert", "50, 0, 40, 20", "Devanagari"]) {
      expect(prompt).toContain(text);
    }
    expect(prompt).toMatch(/"?Insert"? is selected/);
  });

  it("never carries the learner's words, a screenshot or the window title", () => {
    const context = ctx({ utterance: "my salary is 90000", focusRegion: annotation("ask", INSERT_BOUNDS, "what is my bonus") });
    const request = JSON.stringify(buildGeminiRequest(context, HOME_SELECTED.elements));
    expect(request).not.toMatch(/salary|90000|bonus|data:image|base64|png/i);
    expect(request).not.toContain("Book1");
    expect(Object.keys(buildGeminiRequest(context, HOME_SELECTED.elements)).sort()).toEqual(["prompt", "system"]);
  });

  it("caps how many controls are sent", () => {
    const many = Array.from({ length: MAX_GEMINI_ELEMENTS + 20 }, (_, i) => el(`Button ${i}`, "button"));
    const request = new GeminiReasoningProvider(bridge(POINT_AT_INSERT)).request(ctx({ step: undefined, observation: obs(many) }));
    expect(request.candidates).toHaveLength(MAX_GEMINI_ELEMENTS);
  });
});

describe("GeminiReasoningProvider", () => {
  it("maps a valid reply to a teaching action grounded in the observation", async () => {
    const { invoke } = bridge(POINT_AT_INSERT);
    const action = await new GeminiReasoningProvider({ invoke }).reason(ctx());
    expect(invoke).toHaveBeenCalledWith("gemini_reason", { request: expect.objectContaining({ system: expect.any(String), prompt: expect.any(String) }) });
    expect(action).toEqual({
      kind: "guide",
      speech: "Open the Insert tab.",
      target: { elementId: "tab item:Insert", bounds: INSERT_BOUNDS, confidence: 0.9, label: "Insert" },
      skill: "excel.navigation.insert_tab",
      assistanceLevel: "guide",
    });
  });

  it("turns guidance after a mistake into a correction", async () => {
    const action = await new GeminiReasoningProvider(bridge(POINT_AT_INSERT)).reason(ctx({ correction: "You opened Data." }));
    expect(action.kind).toBe("correct");
  });

  it("gives no target when the model points at nothing", async () => {
    const action = await new GeminiReasoningProvider(bridge({ ...POINT_AT_INSERT, target_index: -1 })).reason(ctx());
    expect(action.target).toBeUndefined();
  });

  it("throws on a reply that breaks the contract", async () => {
    await expect(new GeminiReasoningProvider(bridge({ kind: "dance", speech: "x", target_index: 0, confidence: 1 })).reason(ctx())).rejects.toThrow(/contract/);
    await expect(new GeminiReasoningProvider(bridge("Sure! Click Insert.")).reason(ctx())).rejects.toThrow(/contract/);
  });

  it("rejects targets not in the observation", async () => {
    await expect(new GeminiReasoningProvider(bridge({ ...POINT_AT_INSERT, target_index: 7 })).reason(ctx())).rejects.toThrow(/not on screen/);
    const invented = { ...POINT_AT_INSERT, target_index: -1, bbox: [0, 0, 100, 100] };
    await expect(new GeminiReasoningProvider(bridge(invented)).reason(ctx())).rejects.toThrow(/not on screen/);
  });

  it("leaves learner questions to the local model without sending anything", async () => {
    const { invoke } = bridge(POINT_AT_INSERT);
    const provider = new GeminiReasoningProvider({ invoke });
    await expect(provider.reason(ctx({ utterance: "what is this?" }))).rejects.toBeInstanceOf(CloudSkipped);
    await expect(provider.reason(ctx({ focusRegion: annotation("ask", INSERT_BOUNDS) }))).rejects.toBeInstanceOf(CloudSkipped);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports healthy when a key is saved, without calling Gemini", async () => {
    const { invoke } = bridge(POINT_AT_INSERT);
    expect(await new GeminiReasoningProvider({ invoke }).healthCheck()).toBe(true);
    expect(invoke).toHaveBeenCalledWith("cloud_key_status");
    expect(invoke).not.toHaveBeenCalledWith("gemini_reason", expect.anything());
  });

  it("reports unhealthy when key status can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invoke = vi.fn(async () => Promise.reject(new Error("no bridge"))) as unknown as Invoke;
    expect(await new GeminiReasoningProvider({ invoke }).healthCheck()).toBe(false);
  });
});
