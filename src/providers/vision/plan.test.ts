import { describe, expect, it, vi } from "vitest";
import type { HodePlan, TeachingContext } from "../../lib/types";
import { HOME_SELECTED } from "../../features/hode/test-fixtures";
import { LocalPlanner, parsePlan, planMessages } from "./plan";
import { buildMessages } from "./prompt";

const PLAN: HodePlan = {
  concept: "A message goes to whichever channel is open.",
  steps: [{ objective: "Write the message", control: "Message #general", hint: "Where do you type?", why: "The box sends to this channel." }],
  recap: "You typed and sent a message.",
  check: { question: "Where does it go?", options: ["The open channel", "Everyone"], answer: 0, explain: "Discord sends to what's open." },
};

describe("parsePlan", () => {
  it("reads the model's plan", () => {
    expect(parsePlan(JSON.stringify(PLAN))).toEqual(PLAN);
  });

  it("keeps the plan but drops a check whose answer isn't one of its options", () => {
    const plan = parsePlan(JSON.stringify({ ...PLAN, check: { ...PLAN.check, answer: 5 } }));
    expect(plan.steps).toEqual(PLAN.steps);
    expect(plan).not.toHaveProperty("check");
  });

  it("refuses a plan without steps", () => {
    expect(() => parsePlan(JSON.stringify({ ...PLAN, steps: [] }))).toThrow();
  });
});

describe("planMessages", () => {
  it("fences the learner's goal and the app as data, and keeps reference steps in the one system message", () => {
    const [system, user, ...rest] = planMessages({ goal: "send a <b>message</b>", app: "Discord", reference: "<web>[1] Open a channel</web>", language: "hi" });
    expect(rest).toEqual([]);
    expect(system.role).toBe("system");
    expect(system.content).toContain("<web>[1] Open a channel</web>");
    expect(system.content).toContain("Hindi");
    expect(user.content).toContain("<learner>send a b message /b</learner>");
    expect(user.content).toContain("<screen>Discord</screen>");
  });
});

describe("LocalPlanner", () => {
  it("asks the local model for a plan as JSON and reads it", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(PLAN) } }] })));
    const planner = new LocalPlanner({ connection: () => ({ endpoint: "http://127.0.0.1:1", apiKey: "k" }), fetch });
    await expect(planner.plan({ goal: "send a message" }, new AbortController().signal)).resolves.toEqual(PLAN);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:1/v1/chat/completions");
    expect(JSON.parse(init.body as string)).toMatchObject({ response_format: { type: "json_schema" } });
  });

  it("says why when the local model isn't running", async () => {
    const planner = new LocalPlanner({ connection: () => undefined, unavailableReason: () => "Vision is still loading." });
    await expect(planner.plan({ goal: "send a message" }, new AbortController().signal)).rejects.toThrow("Vision is still loading.");
  });
});

describe("the open-goal prompt with a plan", () => {
  const textOf = (context: TeachingContext): string => {
    const [, user] = buildMessages(context, [], { png: "", rect: { x: 0, y: 0, width: 800, height: 600 } });
    return (user.content as Array<{ type: string; text?: string }>).map((part) => part.text ?? "").join("\n");
  };
  const ctx = (plan?: HodePlan["steps"]): TeachingContext => ({ goal: "send a message", observation: HOME_SELECTED, assistanceLevel: "hint", recentMistakes: 0, openGoal: true, plan });

  it("lists the planned steps as data to follow where they fit the screen", () => {
    const text = textOf(ctx(PLAN.steps));
    expect(text).toContain("<web>1. Write the message: Message #general (ask first: Where do you type?; why: The box sends to this channel.)</web>");
    expect(text).not.toContain("There is no fixed plan");
  });

  it("says there's no fixed plan without one", () => {
    expect(textOf(ctx())).toContain("There is no fixed plan");
  });
});
