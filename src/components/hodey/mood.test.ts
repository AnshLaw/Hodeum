import { describe, expect, it } from "vitest";
import { initialState, type HodeState } from "../../features/hode/model";
import { PACK, guideAction } from "../../features/hode/test-fixtures";
import { hodeyMood } from "./mood";

const at = (overrides: Partial<HodeState>): HodeState => ({ ...initialState, pack: PACK, ...overrides });

describe("hodeyMood", () => {
  it("sleeps while idle and wakes when you hover", () => {
    expect(hodeyMood(initialState, false)).toBe("sleeping");
    expect(hodeyMood(initialState, true)).toBe("awake");
  });

  it("listens for a goal, looks, then thinks", () => {
    expect(hodeyMood(at({ phase: "goal_entry" }), false)).toBe("listening");
    expect(hodeyMood(at({ phase: "observing" }), false)).toBe("looking");
    expect(hodeyMood(at({ phase: "reasoning" }), false)).toBe("thinking");
  });

  it("only thinks when a vision model or the cloud is working, not for a quick local re-check", () => {
    const action = guideAction();
    expect(hodeyMood(at({ phase: "reasoning", action }), false)).toBe("guiding");
    expect(hodeyMood(at({ phase: "reasoning", action, thinking: true }), false)).toBe("thinking");
    expect(hodeyMood(at({ phase: "reasoning", action, spokenQuestion: "what is this" }), false)).toBe("thinking");
  });

  it("guides, watches when you work unaided, and reacts to a mistake", () => {
    expect(hodeyMood(at({ phase: "guiding", action: guideAction() }), false)).toBe("guiding");
    expect(hodeyMood(at({ phase: "guiding", level: "observe", action: guideAction() }), false)).toBe("watching");
    expect(hodeyMood(at({ phase: "guiding", action: guideAction({ kind: "correct" }) }), false)).toBe("correcting");
  });

  it("covers Point & Ask, pause, failure, and success", () => {
    expect(hodeyMood(at({ phase: "annotating" }), false)).toBe("curious");
    expect(hodeyMood(at({ phase: "answering" }), false)).toBe("speaking");
    expect(hodeyMood(at({ phase: "paused" }), false)).toBe("resting");
    expect(hodeyMood(at({ phase: "recovering" }), false)).toBe("confused");
    expect(hodeyMood(at({ phase: "success" }), false)).toBe("celebrating");
  });
});
