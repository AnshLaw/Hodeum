import { describe, expect, it } from "vitest";
import type { StateSignal } from "../../lib/types";
import { applyOutcome, clampToMode, confidenceBand, escalate, nextStoredLevel, overlayFor, relax, startLevel } from "./policy";
import { skillRecord } from "./test-fixtures";
import { becameTrue, evaluateSignal, nameMatches } from "./signals";
import { DATA_SELECTED, HOME_SELECTED, INSERT_BOUNDS, guideAction } from "./test-fixtures";

describe("nameMatches", () => {
  it("matches case-insensitively and normalizes ellipses", () => {
    expect(nameMatches("Insert", "insert")).toBe(true);
    expect(nameMatches("Compress to…", "Compress to...")).toBe(true);
  });

  it("supports * wildcards", () => {
    expect(nameMatches("*.zip", "report.zip")).toBe(true);
    expect(nameMatches("*.zip", "report.zip.txt")).toBe(false);
  });
});

describe("evaluateSignal", () => {
  it("evaluates every signal kind", () => {
    expect(evaluateSignal({ kind: "element_visible", names: ["Data"] }, HOME_SELECTED)).toBe(true);
    expect(evaluateSignal({ kind: "element_absent", names: ["PivotTable"] }, HOME_SELECTED)).toBe(true);
    expect(evaluateSignal({ kind: "element_selected", names: ["Data"] }, DATA_SELECTED)).toBe(true);
    expect(evaluateSignal({ kind: "element_selected", names: ["Data"] }, HOME_SELECTED)).toBe(false);
    expect(evaluateSignal({ kind: "window_title_contains", text: "excel" }, HOME_SELECTED)).toBe(true);
  });

  it("only reports a transition into the state", () => {
    const signal: StateSignal = { kind: "element_selected", names: ["Data"] };
    expect(becameTrue(signal, HOME_SELECTED, DATA_SELECTED)).toBe(true);
    expect(becameTrue(signal, DATA_SELECTED, DATA_SELECTED)).toBe(false);
    expect(becameTrue(signal, undefined, DATA_SELECTED)).toBe(true);
  });
});

describe("assistance ladder", () => {
  it("clamps at both ends", () => {
    expect(escalate("demonstrate")).toBe("demonstrate");
    expect(escalate("hint")).toBe("guide");
    expect(relax("independent")).toBe("independent");
    expect(relax("guide")).toBe("hint");
  });

  it("relaxes only after an unaided completion", () => {
    expect(nextStoredLevel({ completed: true, mistakes: 0, level: "guide", escalated: false })).toBe("hint");
    expect(nextStoredLevel({ completed: true, mistakes: 1, level: "guide", escalated: true })).toBe("guide");
  });

  it("builds and updates skill records", () => {
    const first = applyOutcome(null, "s.a", { completed: true, mistakes: 1, level: "demonstrate", escalated: true }, "t1");
    expect(first).toMatchObject({ status: "learning", success_count: 1, failure_count: 1, confidence: 0.5, last_assistance_level: "demonstrate" });
    const mastered = applyOutcome({ ...first, last_assistance_level: "observe" }, "s.a", { completed: true, mistakes: 0, level: "observe", escalated: false }, "t2");
    expect(mastered).toMatchObject({ status: "mastered", last_assistance_level: "independent", last_seen_at: "t2" });
  });
});

describe("learning modes", () => {
  it("teach mode starts every new step as a challenge, never with the answer", () => {
    expect(startLevel("teach", null)).toBe("hint");
    expect(startLevel("teach", skillRecord("guide"))).toBe("hint");
    expect(startLevel("teach", skillRecord("observe"))).toBe("observe");
  });

  it("help mode stays quiet until asked", () => {
    expect(startLevel("help", null)).toBe("observe");
    expect(startLevel("help", skillRecord("independent"))).toBe("independent");
  });

  it("agent mode guides every step, fully for a brand-new skill", () => {
    expect(startLevel("agent", null)).toBe("demonstrate");
    expect(startLevel("agent", skillRecord("independent"))).toBe("guide");
    expect(startLevel("agent", skillRecord("demonstrate"))).toBe("demonstrate");
  });

  it("switching modes mid-step moves the current help level into the new mode's range", () => {
    expect(clampToMode("teach", "demonstrate")).toBe("hint");
    expect(clampToMode("help", "guide")).toBe("observe");
    expect(clampToMode("agent", "observe")).toBe("guide");
    expect(clampToMode("agent", "demonstrate")).toBe("demonstrate");
  });
});

describe("confidence policy", () => {
  it("bands at the documented thresholds", () => {
    expect(confidenceBand(0.85)).toBe("precise");
    expect(confidenceBand(0.84)).toBe("broad");
    expect(confidenceBand(0.65)).toBe("broad");
    expect(confidenceBand(0.64)).toBe("uncertain");
  });
});

describe("overlayFor", () => {
  const kinds = (action = guideAction(), pin?: typeof INSERT_BOUNDS) => overlayFor(action, pin).map((p) => p.kind);

  it("demonstrate draws spotlight, highlight and arrow", () => {
    expect(kinds()).toEqual(["spotlight", "highlight", "arrow"]);
  });

  it("guide draws only a highlight; hint draws nothing", () => {
    expect(kinds(guideAction({ assistanceLevel: "guide" }))).toEqual(["highlight"]);
    expect(kinds(guideAction({ assistanceLevel: "hint" }))).toEqual([]);
  });

  it("a correction always shows where to go", () => {
    expect(kinds(guideAction({ kind: "correct", assistanceLevel: "hint" }))).toEqual(["highlight"]);
  });

  it("medium confidence widens the highlight and drops the arrow", () => {
    const [highlight] = overlayFor(guideAction({ target: { elementId: "x", bounds: INSERT_BOUNDS, confidence: 0.7, label: "Insert" } }));
    expect(highlight).toMatchObject({ kind: "highlight", emphasis: "broad", bounds: { x: 26, y: -24, width: 88, height: 68 } });
  });

  it("low confidence draws nothing but keeps the pin", () => {
    const action = guideAction({ target: { elementId: "x", bounds: INSERT_BOUNDS, confidence: 0.4, label: "Insert" } });
    expect(kinds(action, INSERT_BOUNDS)).toEqual(["pin"]);
  });
});

describe("screen_tone signal", () => {
  const observation = (tone?: "dark" | "light") => ({ app: "iPhone", windowTitle: "", elements: [], at: 0, tone });

  it("holds when the screen's tone matches", () => {
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation("dark"))).toBe(true);
  });

  it("fails for the other tone or an unknown tone", () => {
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation("light"))).toBe(false);
    expect(evaluateSignal({ kind: "screen_tone", tone: "dark" }, observation())).toBe(false);
  });
});
