import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME_SELECTED, INSERT_BOUNDS, PACK, annotation, el, obs } from "../../features/hode/test-fixtures";
import type { TeachingContext } from "../../lib/types";
import { CloudSkipped } from "./gated";
import { CONTENT_PLACEHOLDER, GeminiReasoningProvider, STUCK_NOTE, MAX_GEMINI_ELEMENTS, buildGeminiRequest } from "./gemini-reasoner";

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
    for (const text of [PACK.title, "Open the Insert tab", "excel.navigation.insert_tab", "guide", "tab item", "Insert", "50, 0, 40, 20", "Devanagari"]) {
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

  it("sends the lesson's title, never the learner's own goal words", () => {
    const { prompt } = buildGeminiRequest(ctx({ goal: "pivot my HDFC salary sheet" }), HOME_SELECTED.elements);
    expect(prompt).toContain(PACK.title);
    expect(prompt).not.toMatch(/HDFC|salary/);
  });

  it("hides what content controls say (file names, list items, text boxes) but keeps interface labels", () => {
    const controls = [el("Share", "button"), el("Tax return 2025.pdf", "list item"), el("Dear landlord", "edit"), el("Priya Sharma", "text")];
    const { prompt } = buildGeminiRequest(ctx({ step: undefined }), controls);
    expect(prompt).toContain("Share");
    expect(prompt).not.toMatch(/Tax return|landlord|Priya/);
    expect(prompt).toContain(CONTENT_PLACEHOLDER);
  });

  it("names the step's target by the lesson's own label, whatever control holds it", () => {
    const step = { ...PACK.steps[0], target: { names: ["Insert*"], label: "Insert" } };
    const { prompt } = buildGeminiRequest(ctx({ step }), [el("Insert - Jane's budget.xlsx", "list item")]);
    expect(prompt).toContain('"Insert"');
    expect(prompt).not.toMatch(/Jane|budget/);
  });

  it("scrubs emails, links, paths and long numbers from interface labels", () => {
    const controls = [el("Save to OneDrive - jane@contoso.com", "button"), el("Open C:\\Users\\jane\\Taxes", "button"), el("Open https://bank.example/acct", "button"), el("Invoice 48392017", "button")];
    const { prompt } = buildGeminiRequest(ctx({ step: undefined }), controls);
    expect(prompt).toContain("Save to OneDrive");
    expect(prompt).not.toMatch(/jane|contoso|Taxes|bank\.example|48392017/i);
  });

  it("sends a lesson's own correction, but only a generic note for corrections built from the screen", () => {
    const lessonCorrection = PACK.steps[0].mistakes[0].correction;
    expect(buildGeminiRequest(ctx({ correction: lessonCorrection }), HOME_SELECTED.elements).prompt).toContain(lessonCorrection);
    const { prompt } = buildGeminiRequest(ctx({ correction: 'You clicked "Tax return 2025.pdf" three times. Close "Save changes to Jane-budget.xlsx?" first.' }), HOME_SELECTED.elements);
    expect(prompt).not.toMatch(/Tax return|Jane|budget/);
    expect(prompt).toContain(STUCK_NOTE);
  });

  it("treats tab names as content: browser tabs and sheet names are the learner's", () => {
    const { prompt } = buildGeminiRequest(ctx({ step: undefined }), [el("Gmail - Inbox", "tab item"), el("Salary 2025", "sheet tab")]);
    expect(prompt).not.toMatch(/Gmail|Inbox|Salary/);
  });

  it("never sends element ids, which can carry names on some surfaces", () => {
    const { prompt } = buildGeminiRequest(ctx(), [el("Insert", "tab item", { id: "file:secret-plan.docx" })]);
    expect(prompt).not.toContain("secret-plan");
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
    expect(invoke).toHaveBeenCalledWith("gemini_reason", { request: expect.objectContaining({ system: expect.any(String), prompt: expect.any(String) }), model: "gemini-3.8-flash" });
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

  it("leaves open-ended goals to the local model, since the goal is the learner's own words", async () => {
    const { invoke } = bridge(POINT_AT_INSERT);
    const open = ctx({ pack: undefined, step: undefined, openGoal: true, goal: "fix my resume formatting" });
    await expect(new GeminiReasoningProvider({ invoke }).reason(open)).rejects.toBeInstanceOf(CloudSkipped);
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
