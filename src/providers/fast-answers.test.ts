import { describe, expect, it } from "vitest";
import type { TeachingAction, TeachingContext } from "../lib/types";
import { HOME_SELECTED, PACK, annotation, el, obs, tab } from "../features/hode/test-fixtures";
import type { ReasoningProvider } from "./interfaces";
import { GroundedPlannerProvider, LocalReasoningProvider } from "./local-reasoner";
import { reasonWithFallback } from "./router";
import { TaskPackReasoningProvider } from "./task-pack-reasoner";

/** A question the local planner can answer completely is answered at once, without waiting on the vision model. */

const ctx = (overrides: Partial<TeachingContext>): TeachingContext => ({ goal: "pivot", pack: PACK, step: PACK.steps[0], observation: HOME_SELECTED, assistanceLevel: "hint", recentMistakes: 0, ...overrides });

function vision(): ReasoningProvider & { calls: number } {
  const provider = {
    id: "vision",
    calls: 0,
    async reason(): Promise<TeachingAction> {
      provider.calls += 1;
      return { kind: "answer", speech: "from the vision model", skill: "general.vision", assistanceLevel: "hint" };
    },
    healthCheck: async () => true,
  };
  return provider;
}

const chain = (model: ReasoningProvider) => {
  const planner = new TaskPackReasoningProvider();
  return [new GroundedPlannerProvider(planner), new LocalReasoningProvider(planner, model, () => true)];
};

describe("answers the planner can give completely", () => {
  it("\"where is Insert?\" points at Insert straight away", async () => {
    const model = vision();
    const { action } = await reasonWithFallback(chain(model), ctx({ utterance: "where is the Insert tab?" }));
    expect(action).toMatchObject({ kind: "answer", target: { label: "Insert" } });
    expect(model.calls).toBe(0);
  });

  it("in Hindi too: \"इंसर्ट कहाँ है\" is a where-question", async () => {
    const model = vision();
    const hindi = obs([tab("इंसर्ट", 1)]);
    const { action } = await reasonWithFallback(chain(model), ctx({ observation: hindi, utterance: "इंसर्ट कहाँ है" }));
    expect(action.target?.label).toBe("इंसर्ट");
    expect(model.calls).toBe(0);
  });

  it("a marked control from the lesson gets the lesson's own explanation straight away", async () => {
    const model = vision();
    const marked = annotation("ask", { x: 50, y: 0, width: 40, height: 20 }, "what is this?");
    const { action } = await reasonWithFallback(chain(model), ctx({ focusRegion: marked, utterance: "what is this?" }));
    expect(action.speech).toContain(PACK.steps[0].explain);
    expect(model.calls).toBe(0);
  });
});

describe("questions that need the vision model", () => {
  it("\"what does Insert do?\" goes to the model, even though Insert is on screen", async () => {
    const model = vision();
    const { action } = await reasonWithFallback(chain(model), ctx({ utterance: "what does the Insert tab do?" }));
    expect(action.speech).toBe("from the vision model");
  });

  it("a marked control the lesson doesn't know goes to the model", async () => {
    const model = vision();
    const bold = el("Bold", "button", { bounds: { x: 300, y: 0, width: 20, height: 20 } });
    const marked = annotation("ask", { x: 295, y: 0, width: 30, height: 20 }, "what is this?");
    const { action } = await reasonWithFallback(chain(model), ctx({ observation: obs([...HOME_SELECTED.elements, bold]), focusRegion: marked, utterance: "what is this?" }));
    expect(action.speech).toBe("from the vision model");
  });
});
