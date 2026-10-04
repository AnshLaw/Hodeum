import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../hode/model";
import { PACK } from "../hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import { routeUtterance } from "./route";

const guiding: HodeState = { ...initialState, phase: "guiding", pack: PACK };
const route = (s: HodeState, text: string, openAllowed = false) => routeUtterance(s, text, TASK_PACKS, openAllowed);
const types = (events: { type: string }[]) => events.map((e) => e.type);

describe("routeUtterance", () => {
  it("starts a Hode from a spoken goal when idle", () => {
    const events = route(initialState, "Hey Hodey, teach me how to make a pivot table in Excel");
    expect(types(events)).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(events[1]).toMatchObject({ goal: "teach me how to make a pivot table in Excel", pack: { id: "excel-pivot" } });
  });

  it("treats an idle what/where question as a question about the screen", () => {
    expect(route(initialState, "What does this button do?")).toEqual([{ type: "VOICE_QUESTION", question: "What does this button do?" }]);
  });

  it("asks a question when a goal has no pack and vision can't plan it", () => {
    expect(types(route(initialState, "how do I write a poem"))).toEqual(["VOICE_QUESTION"]);
    expect(types(route(initialState, "how do I write a poem", true))).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
  });

  it("submits whatever is said during goal entry as the goal", () => {
    expect(route({ ...initialState, phase: "goal_entry" }, "zip these files")).toMatchObject([{ type: "GOAL_SUBMITTED", goal: "zip these files" }]);
  });

  it("maps spoken controls during a Hode, ignoring the wake word and politeness", () => {
    expect(route(guiding, "Hodey, give me a hint please")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "say that again")).toEqual([{ type: "REPEAT" }]);
    expect(route(guiding, "I did it")).toEqual([{ type: "LOOK_AGAIN" }]);
    expect(route(guiding, "stop")).toEqual([{ type: "END_HODE" }]);
    expect(route({ ...guiding, phase: "paused" }, "continue")).toEqual([{ type: "RESUME" }]);
    expect(route({ ...guiding, phase: "answering" }, "got it, thanks")).toEqual([{ type: "DISMISS" }]);
  });

  it("asks anything else as a question, mid-Hode", () => {
    expect(route(guiding, "where is the insert tab")).toEqual([{ type: "VOICE_QUESTION", question: "where is the insert tab" }]);
  });

  it("ignores silence and noise", () => {
    expect(route(guiding, "  ")).toEqual([]);
    expect(route(guiding, "um")).toEqual([]);
  });
});
