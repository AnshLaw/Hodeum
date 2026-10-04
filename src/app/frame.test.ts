import { describe, expect, it } from "vitest";
import { guidanceHidden, nextPhase, presenceOf, type FrameEvent, type FramePhase } from "./frame";

function run(events: FrameEvent[], from: FramePhase = "hidden"): FramePhase {
  return events.reduce(nextPhase, from);
}

describe("app frame transitions", () => {
  it("unfolds out of the notch, then folds back into it and hides", () => {
    expect(run(["show"])).toBe("unfolding");
    expect(run(["show", "unfolded"])).toBe("open");
    expect(run(["show", "unfolded", "close"])).toBe("folding");
    expect(run(["show", "unfolded", "close", "folded"])).toBe("hidden");
  });

  it("can be closed mid-unfold and reopened mid-fold", () => {
    expect(run(["show", "close"])).toBe("folding");
    expect(run(["show", "unfolded", "close", "show"])).toBe("unfolding");
  });

  it("ignores a second close while folding and a stale 'unfolded' after closing", () => {
    expect(run(["close"], "folding")).toBe("folding");
    expect(run(["show", "close", "unfolded"])).toBe("folding");
    expect(run(["close", "folded"], "hidden")).toBe("hidden");
  });

  it("showing an app that is already open does not replay the unfold", () => {
    expect(run(["show"], "open")).toBe("open");
  });

  it("minimizes and restores without animating, and closing a minimized app just hides it", () => {
    expect(run(["minimized"], "open")).toBe("minimized");
    expect(run(["restored"], "minimized")).toBe("open");
    expect(run(["show"], "minimized")).toBe("open");
    expect(run(["close"], "minimized")).toBe("hidden");
  });

  it("ignores restore events while hidden or folding (they fire on every resize)", () => {
    expect(run(["restored"], "hidden")).toBe("hidden");
    expect(run(["restored"], "folding")).toBe("folding");
  });
});

describe("what the notch and overlay see", () => {
  it("the notch steps aside only while the app is really on screen", () => {
    expect(presenceOf("unfolding")).toBe("open");
    expect(presenceOf("open")).toBe("open");
    expect(presenceOf("folding")).toBe("closing");
    expect(presenceOf("minimized")).toBe("closed");
    expect(presenceOf("hidden")).toBe("closed");
  });

  it("guidance is hidden only while the open app has focus", () => {
    expect(guidanceHidden({ presence: "open", focused: true })).toBe(true);
    expect(guidanceHidden({ presence: "open", focused: false })).toBe(false);
    expect(guidanceHidden({ presence: "closing", focused: true })).toBe(false);
    expect(guidanceHidden(undefined)).toBe(false);
  });
});
