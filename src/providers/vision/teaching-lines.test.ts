import { describe, expect, it } from "vitest";
import type { AssistanceLevel, TeachingContext } from "../../lib/types";
import { HOME_SELECTED } from "../../features/hode/test-fixtures";
import { buildMessages } from "./prompt";

/** What the vision model is told to do at each rung of the help ladder, and about an open goal so far. */

const frame = { png: "", rect: { x: 0, y: 0, width: 800, height: 600 } };
const textOf = (context: TeachingContext): string => {
  const [, user] = buildMessages(context, [], frame);
  const content = user.content as Array<{ type: string; text?: string }>;
  return content.find((part) => part.type === "text")?.text ?? "";
};
const ctx = (assistanceLevel: AssistanceLevel, overrides: Partial<TeachingContext> = {}): TeachingContext => ({ goal: "save as pdf", observation: HOME_SELECTED, assistanceLevel, recentMistakes: 0, openGoal: true, ...overrides });

describe("teaching lines for the vision model", () => {
  it("at a hint, asks for a clue or question that doesn't name the control, but still wants it pointed at", () => {
    const text = textOf(ctx("hint"));
    expect(text).toMatch(/Don't name the control/);
    expect(text).toMatch(/target_index/);
  });

  it("at a demonstration, asks for the exact control and a few words on why", () => {
    expect(textOf(ctx("demonstrate"))).toMatch(/why/);
  });

  it("gives the steps done so far and the full last instruction in an open-ended Hode", () => {
    const last = "Open the File menu at the top left, then look for the options about saving your document in another format.";
    const text = textOf(ctx("guide", { doneSteps: ["Click the Home tab."], lastInstruction: last }));
    expect(text).toContain("1. Click the Home tab.");
    expect(text).toContain(last);
  });
});
