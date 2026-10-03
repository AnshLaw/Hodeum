import { describe, expect, it, vi } from "vitest";
import type { TeachingAction, TeachingContext } from "../../lib/types";
import { HOME_SELECTED, INSERT_BOUNDS, PACK, annotation, el, obs, tab } from "../../features/hode/test-fixtures";
import type { ReasoningProvider } from "../interfaces";
import { LocalReasoningProvider } from "../local-reasoner";
import { buildMessages, fromImageBox, selectCandidates, toImageBox } from "./prompt";
import { QwenVisionProvider, VISUAL_CONFIDENCE_CAP } from "./qwen-vision-provider";
import { parseVisionReply } from "./schema";
import type { CapturedFrame } from "./types";

const FRAME: CapturedFrame = { png: "iVBOR", rect: { x: 0, y: 0, width: 1000, height: 500 } };
const ctx = (overrides: Partial<TeachingContext> = {}): TeachingContext => ({
  goal: "make a pivot table",
  pack: PACK,
  step: PACK.steps[0],
  observation: HOME_SELECTED,
  assistanceLevel: "guide",
  recentMistakes: 0,
  ...overrides,
});

function fakeFetch(reply: object | string, status = 200) {
  const content = typeof reply === "string" ? reply : JSON.stringify(reply);
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));
}

const provider = (fetchImpl: ReturnType<typeof fakeFetch>) =>
  new QwenVisionProvider({ connection: () => ({ endpoint: "http://127.0.0.1:8737", apiKey: "k" }), capture: async () => FRAME, fetch: fetchImpl as unknown as typeof fetch });

describe("vision prompt", () => {
  it("puts the step's target first and drops non-actionable controls", () => {
    const observation = obs([el("Status Bar", "status bar"), tab("Home", 0), tab("Insert", 1)]);
    expect(selectCandidates(ctx({ observation })).map((e) => e.name)).toEqual(["Insert", "Home"]);
  });

  it("converts between screen rects and the model's 0–1000 image boxes", () => {
    const rect = { x: 100, y: 50, width: 200, height: 100 };
    expect(toImageBox(rect, FRAME.rect)).toEqual([100, 100, 300, 300]);
    expect(fromImageBox([100, 100, 300, 300], FRAME.rect)).toEqual(rect);
  });

  it("sends the screenshot and a numbered control list", () => {
    const [, user] = buildMessages(ctx(), selectCandidates(ctx()), FRAME) as [unknown, { content: { type: string; text?: string }[] }];
    expect(user.content[0].type).toBe("image_url");
    expect(user.content[1].text).toContain('0. tab item "Insert"');
  });
});

describe("parseVisionReply", () => {
  it("rejects malformed output with a clear error", () => {
    expect(() => parseVisionReply("Sure! Click Insert.")).toThrow(/isn't JSON/);
    expect(() => parseVisionReply(JSON.stringify({ kind: "dance", speech: "x", target_index: 0, confidence: 1 }))).toThrow(/contract/);
  });
});

describe("QwenVisionProvider", () => {
  it("grounds the answer to a listed UI Automation control", async () => {
    const fetchImpl = fakeFetch({ kind: "guide", speech: "Open the Insert tab.", target_index: 0, confidence: 0.9 });
    const action = await provider(fetchImpl).reason(ctx());
    expect(action).toMatchObject({ kind: "guide", speech: "Open the Insert tab.", target: { label: "Insert", bounds: INSERT_BOUNDS, confidence: 0.9 } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8737/v1/chat/completions",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer k" }) }),
    );
  });

  it("caps confidence for a pixel-only box so it never draws a precise arrow", async () => {
    const action = await provider(fakeFetch({ kind: "guide", speech: "Click here.", target_index: -1, bbox: [100, 100, 200, 200], confidence: 0.99 })).reason(ctx());
    expect(action.target?.confidence).toBe(VISUAL_CONFIDENCE_CAP);
    expect(action.target?.bounds).toEqual({ x: 100, y: 50, width: 100, height: 50 });
  });

  it("marks guidance as a correction after a mistake", async () => {
    const action = await provider(fakeFetch({ kind: "guide", speech: "Insert is to the left.", target_index: 0, confidence: 0.9 })).reason(ctx({ correction: "You opened Data." }));
    expect(action.kind).toBe("correct");
  });

  it("refuses to run before the local server is ready", async () => {
    const offline = new QwenVisionProvider({ connection: () => undefined, capture: async () => FRAME, fetch: fakeFetch({}) as unknown as typeof fetch });
    await expect(offline.reason(ctx())).rejects.toThrow(/isn't running/);
  });

  it("surfaces server errors", async () => {
    await expect(provider(fakeFetch("boom", 500)).reason(ctx())).rejects.toThrow(/answered 500/);
  });
});

describe("LocalReasoningProvider", () => {
  const action = (kind: TeachingAction["kind"], speech: string = kind): TeachingAction => ({ kind, speech, skill: "s.k", assistanceLevel: "guide" });
  const stub = (result: TeachingAction | Error): ReasoningProvider => ({
    id: "stub",
    reason: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
    healthCheck: async () => true,
  });

  it("uses the planner when it can ground the step, without calling vision", async () => {
    const vision = stub(action("guide", "vision"));
    const local = new LocalReasoningProvider(stub(action("guide", "planner")), vision, () => true);
    await expect(local.reason(ctx())).resolves.toMatchObject({ speech: "planner" });
    expect(vision.reason).not.toHaveBeenCalled();
  });

  it("asks vision when the planner can't find the target or for Point & Ask", async () => {
    const local = new LocalReasoningProvider(stub(action("clarify")), stub(action("guide", "vision")), () => true);
    await expect(local.reason(ctx())).resolves.toMatchObject({ speech: "vision" });
    const asking = new LocalReasoningProvider(stub(action("answer", "pack answer")), stub(action("answer", "vision answer")), () => true);
    await expect(asking.reason(ctx({ focusRegion: annotation("ask", INSERT_BOUNDS, "?") }))).resolves.toMatchObject({ speech: "vision answer" });
  });

  it("falls back to the planner when vision fails or isn't ready", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = new LocalReasoningProvider(stub(action("clarify", "planner")), stub(new Error("timeout")), () => true);
    await expect(failing.reason(ctx())).resolves.toMatchObject({ speech: "planner" });
    const offline = new LocalReasoningProvider(stub(action("clarify", "planner")), stub(action("guide")), () => false);
    await expect(offline.reason(ctx())).resolves.toMatchObject({ speech: "planner" });
  });

  it("uses vision when there's no planned step at all, and errors if neither works", async () => {
    const noStep = new LocalReasoningProvider(stub(new Error("No task step")), stub(action("guide", "vision")), () => true);
    await expect(noStep.reason(ctx({ step: undefined }))).resolves.toMatchObject({ speech: "vision" });
    const neither = new LocalReasoningProvider(stub(new Error("No task step")), stub(action("guide")), () => false);
    await expect(neither.reason(ctx({ step: undefined }))).rejects.toThrow(/No task step/);
  });
});
