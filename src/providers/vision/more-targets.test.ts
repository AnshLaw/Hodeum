import { describe, expect, it, vi } from "vitest";
import type { TeachingContext } from "../../lib/types";
import { INSERT_SELECTED, PACK, el, obs, tab } from "../../features/hode/test-fixtures";
import { buildMessages, selectCandidates } from "./prompt";
import { QwenVisionProvider } from "./qwen-vision-provider";
import { MAX_LABEL_CHARS, MAX_MORE_TARGETS, VISION_REPLY_JSON_SCHEMA, parseVisionReply, replySchemaFor } from "./schema";
import type { CapturedFrame } from "./types";

/** One step can walk through several controls on screen ("click Insert, then PivotTable"): each is lit, numbered. */

const FRAME: CapturedFrame = { png: "iVBOR", rect: { x: 0, y: 0, width: 1000, height: 500 } };
const ctx = (overrides: Partial<TeachingContext> = {}): TeachingContext => ({
  goal: "make a pivot table",
  pack: PACK,
  step: PACK.steps[0],
  observation: INSERT_SELECTED,
  assistanceLevel: "guide",
  recentMistakes: 0,
  ...overrides,
});

const fakeFetch = (reply: object) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
const reason = (reply: object, context = ctx()) =>
  new QwenVisionProvider({ connection: () => ({ endpoint: "http://127.0.0.1:8737", apiKey: "k" }), capture: async () => FRAME, fetch: fakeFetch(reply) as unknown as typeof fetch }).reason(context);

/** The step targets Insert, so it lists first: Insert 0, Home 1, Data 2, PivotTable 3. */
const INSERT_THEN = (more: object[], speech = "Click 'Insert', then 'PivotTable', then 'Data'.") => ({
  kind: "guide",
  speech,
  target_label: "Insert",
  target_index: 0,
  confidence: 0.95,
  more_targets: more,
});
const PIVOT = { label: "PivotTable", target_index: 3, mention: "PivotTable" };
const DATA = { label: "Data", target_index: 2, mention: "Data" };

describe("more_targets in the reply contract", () => {
  it("accepts up to three later controls, each named, numbered and optionally boxed", () => {
    const reply = parseVisionReply(JSON.stringify(INSERT_THEN([PIVOT, { ...DATA, bbox: [100, 0, 140, 40] }, { label: "Home", target_index: 1, mention: "Home" }])));
    expect(reply.more_targets?.map((t) => t.label)).toEqual(["PivotTable", "Data", "Home"]);
    expect(parseVisionReply(JSON.stringify({ ...INSERT_THEN([]), more_targets: undefined })).more_targets).toBeUndefined();
  });

  it("rejects too many, a bad number, an overlong name and a malformed box", () => {
    const parse = (more: object[]) => () => parseVisionReply(JSON.stringify(INSERT_THEN(more)));
    expect(parse([PIVOT, DATA, PIVOT, DATA])).toThrow(/contract/);
    expect(parse([{ ...PIVOT, target_index: -2 }])).toThrow(/contract/);
    expect(parse([{ ...PIVOT, target_index: 1.5 }])).toThrow(/contract/);
    expect(parse([{ ...PIVOT, label: "x".repeat(MAX_LABEL_CHARS + 1) }])).toThrow(/contract/);
    expect(parse([{ ...PIVOT, mention: "x".repeat(MAX_LABEL_CHARS + 1) }])).toThrow(/contract/);
    expect(parse([{ ...PIVOT, bbox: [1, 2, 3] }])).toThrow(/contract/);
  });

  it("lets the model leave them out, and has it name each control before numbering it", () => {
    for (const schema of [VISION_REPLY_JSON_SCHEMA, replySchemaFor(false)]) {
      expect(schema.required).not.toContain("more_targets");
      const list = schema.properties.more_targets;
      expect(list.maxItems).toBe(MAX_MORE_TARGETS);
      expect(Object.keys(list.items.properties)[0]).toBe("label");
      expect(list.items.required).toEqual(["label", "target_index", "mention"]);
      expect(list.items.additionalProperties).toBe(false);
    }
  });

  it("tells the model when to use them", () => {
    const [system] = buildMessages(ctx(), selectCandidates(ctx()), FRAME) as unknown as [{ content: string }];
    expect(system.content).toMatch(/more_targets/);
    expect(system.content).toMatch(/mention/);
  });
});

describe("grounding later controls (local vision)", () => {
  it("settles each like the target and keeps them in flow order, with the words that name them", async () => {
    const action = await reason(INSERT_THEN([PIVOT, DATA]));
    expect(action.target).toMatchObject({ label: "Insert", mention: "Insert", confidence: 0.95 });
    expect(action.targets).toEqual([
      { elementId: "button:PivotTable", bounds: { x: 0, y: 40, width: 60, height: 50 }, confidence: 0.95, label: "PivotTable", mention: "PivotTable" },
      { elementId: "tab item:Data", bounds: { x: 100, y: 0, width: 40, height: 20 }, confidence: 0.95, label: "Data", mention: "Data" },
    ]);
  });

  it("drops the first control named again and a repeat of a later one", async () => {
    const action = await reason(INSERT_THEN([{ label: "Insert", target_index: 0, mention: "Insert" }, PIVOT, { ...PIVOT, target_index: 1 }]));
    expect(action.targets?.map((t) => t.label)).toEqual(["PivotTable"]);
  });

  it("drops one it can't find and one it isn't sure of", async () => {
    const nowhere = { label: "Formulas", target_index: -1, mention: "Formulas" };
    const unconfirmed = { label: "Formulas", target_index: 2, mention: "Formulas" };
    const action = await reason(INSERT_THEN([nowhere, unconfirmed, DATA]));
    expect(action.targets?.map((t) => t.label)).toEqual(["Data"]);
  });

  it("uses a later control's own box to tell same-named controls apart", async () => {
    const left = el("Close", "button", { bounds: { x: 10, y: 300, width: 40, height: 20 } });
    const right = el("Close", "button", { id: "right-close", bounds: { x: 800, y: 300, width: 40, height: 20 } });
    const context = ctx({ pack: undefined, step: undefined, observation: obs([tab("Home", 0), left, right]) });
    const reply = { kind: "guide", speech: "Open 'Home', then 'Close'.", target_label: "Home", target_index: 0, confidence: 0.95, more_targets: [{ label: "Close", target_index: -1, bbox: [800, 600, 840, 640], mention: "Close" }] };
    const action = await reason(reply, context);
    expect(action.targets).toMatchObject([{ elementId: "right-close", confidence: 0.9 }]);
  });

  it("keeps a mention only when the speech says it", async () => {
    const action = await reason(INSERT_THEN([{ ...PIVOT, mention: "the pivot thing" }, { ...DATA, mention: "" }], "Click 'Insert', then 'PivotTable'. Then the next tab."));
    expect(action.targets?.map((t) => t.mention)).toEqual(["PivotTable", undefined]);
    expect(action.targets?.[1]).not.toHaveProperty("mention");
  });

  it("lights none without a first control, for a question back, or once the Hode is done", async () => {
    const pointless = await reason({ ...INSERT_THEN([PIVOT], "Let's make the table."), target_label: "", target_index: -1 });
    expect(pointless.target).toBeUndefined();
    expect(pointless).not.toHaveProperty("targets");
    for (const kind of ["clarify", "complete"]) expect(await reason({ ...INSERT_THEN([PIVOT]), kind })).not.toHaveProperty("targets");
  });

  it("adds no targets field to a reply with none", async () => {
    expect(await reason({ ...INSERT_THEN([]), more_targets: undefined })).not.toHaveProperty("targets");
  });
});

describe("a step's first control beside later ones (local vision)", () => {
  const CHECK = el("My table has headers", "check box", { bounds: { x: 100, y: 100, width: 200, height: 24 } });
  const OK = el("OK", "button", { bounds: { x: 200, y: 200, width: 60, height: 24 } });
  const CANCEL = el("Cancel", "button", { bounds: { x: 280, y: 200, width: 60, height: 24 } });
  const dialog = () => ctx({ pack: undefined, step: undefined, observation: obs([CHECK, OK, CANCEL]) });
  /** Tick the box (0, boxed in the model's 0-1000 grid), then OK (1). */
  const TICK_THEN = (more: object[], targetLabel = "My table has headers") => ({
    kind: "guide",
    speech: "Tick the headers box, then click 'OK'.",
    target_label: targetLabel,
    target_index: 0,
    bbox: [100, 200, 300, 248],
    confidence: 0.95,
    more_targets: more,
  });

  it("keeps the first control when its name is paraphrased and the speech quotes a later one", async () => {
    const action = await reason(TICK_THEN([{ label: "OK", target_index: 1, mention: "OK" }], "Headers checkbox"), dialog());
    expect(action.target?.elementId).toBe(CHECK.id);
    expect(action.targets?.map((t) => t.elementId)).toEqual([OK.id]);
  });

  it("numbers no later control without a name, whatever its number or box lands on", async () => {
    const byIndex = { label: "", target_index: 2, mention: "" };
    const byBox = { label: " ", target_index: -1, mention: "", bbox: [280, 400, 340, 448] };
    for (const unnamed of [byIndex, byBox]) expect(await reason(TICK_THEN([unnamed]), dialog())).not.toHaveProperty("targets");
  });
});
