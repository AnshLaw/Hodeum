import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../hode/model";
import { PACK } from "../hode/test-fixtures";
import { TASK_PACKS } from "../../task-packs";
import { routeUtterance, wakeRest } from "./route";

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

  it("switches mode and reveals the flow by voice", () => {
    expect(route(guiding, "agent mode")).toEqual([{ type: "SET_MODE", mode: "agent" }]);
    expect(route(guiding, "walk me through every step")).toEqual([{ type: "SET_MODE", mode: "agent" }]);
    expect(route(guiding, "switch to teach mode")).toEqual([{ type: "SET_MODE", mode: "teach" }]);
    expect(route(guiding, "help mode please")).toEqual([{ type: "SET_MODE", mode: "help" }]);
    expect(route(guiding, "show me all the steps")).toEqual([{ type: "SHOW_ALL_STEPS" }]);
  });

  it("asks anything else as a question, mid-Hode", () => {
    expect(route(guiding, "where is the insert tab")).toEqual([{ type: "VOICE_QUESTION", question: "where is the insert tab" }]);
  });

  it("drops the wake word, including the ways speech recognition mishears it", () => {
    expect(route(guiding, "Hello body, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(route(guiding, "hey howdy repeat that")).toEqual([{ type: "REPEAT" }]);
    expect(route(guiding, "Hodie, stop")).toEqual([{ type: "END_HODE" }]);
  });

  it("drops the learner's own wake words too", () => {
    const routeWith = (text: string) => routeUtterance(guiding, text, TASK_PACKS, false, ["Hey Hodes", "Jarvis"]);
    expect(routeWith("hey hodes, give me a hint")).toEqual([{ type: "HINT_REQUESTED" }]);
    expect(routeWith("Jarvis repeat that")).toEqual([{ type: "REPEAT" }]);
    expect(routeWith("Hey Hodi stop")).toEqual([{ type: "END_HODE" }]);
  });

  it("ignores silence and noise", () => {
    expect(route(guiding, "  ")).toEqual([]);
    expect(route(guiding, "um")).toEqual([]);
  });
});

describe("wakeRest (hands-free)", () => {
  it("returns what follows Hodey's name", () => {
    expect(wakeRest("Hey Hodey, give me a hint.", [])).toBe("give me a hint.");
    expect(wakeRest("Hodey what's this button?", [])).toBe("what's this button?");
    expect(wakeRest("Okay Hodi.", [])).toBe("");
  });

  it("accepts the learner's own wake words", () => {
    expect(wakeRest("Hey Hodes, show me the steps", ["Hey Hodes"])).toBe("show me the steps");
  });

  it("ignores room speech that doesn't open with a wake word", () => {
    expect(wakeRest("I told somebody about Hodey yesterday", [])).toBeUndefined();
    expect(wakeRest("body temperature is normal", [])).toBeUndefined();
    expect(wakeRest("hey, what's up", [])).toBeUndefined();
  });

  it("hears Hodey's name in Hindi script", () => {
    expect(wakeRest("हे होडी, मदद करो", [])).toBe("मदद करो");
  });
});
