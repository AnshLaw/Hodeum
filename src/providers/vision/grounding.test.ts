import { describe, expect, it } from "vitest";
import { el } from "../../features/hode/test-fixtures";
import { askedRoles, groundTarget, utterancePoints } from "./grounding";

const row = (y: number) => ({ y, height: 30 });
const MUTE = el("Mute app", "button", { bounds: { x: 1360, ...row(870), width: 40 } });
const SLIDER = el("System sounds", "slider", { bounds: { x: 1500, ...row(870), width: 300 } });
const FAR_SLIDER = el("Volume", "slider", { bounds: { x: 1500, ...row(330), width: 300 } });
const PANE = el("Sound", "pane", { bounds: { x: 0, y: 0, width: 1900, height: 1000 } });
const ELEMENTS = [PANE, FAR_SLIDER, MUTE, SLIDER];

describe("askedRoles", () => {
  it("reads the kind of control the learner asks about", () => {
    expect(askedRoles("Can you show me where the slider")).toContain("slider");
    expect(askedRoles("where is the volume slider?")).toContain("slider");
    expect(askedRoles("which dropdown picks the speaker")).toContain("combo box");
    expect(askedRoles("turn on the toggle")).toContain("toggle switch");
  });

  it("asks about no role when none is named", () => {
    expect(askedRoles("what does this do")).toEqual([]);
  });
});

describe("utterancePoints", () => {
  it("favours controls of the asked role and controls the learner names", () => {
    expect(utterancePoints(SLIDER, "where is the slider")).toBeGreaterThan(0);
    expect(utterancePoints(MUTE, "where is the slider")).toBe(0);
    expect(utterancePoints(MUTE, "what does mute app do")).toBeGreaterThan(0);
  });

  it("ignores short and filler words", () => {
    expect(utterancePoints(el("The app", "button"), "is the app")).toBe(0);
  });
});

describe("groundTarget", () => {
  it("moves a pick of the wrong kind to the asked control beside it", () => {
    expect(groundTarget({ chosen: MUTE, elements: ELEMENTS, utterance: "show me where the slider" })).toBe(SLIDER);
  });

  it("keeps a pick that is already the asked kind", () => {
    expect(groundTarget({ chosen: FAR_SLIDER, elements: ELEMENTS, utterance: "where is the slider" })).toBe(FAR_SLIDER);
  });

  it("follows the model's box when its numbered pick sits elsewhere (a miscounted index)", () => {
    const box = { x: 1600, y: 875, width: 20, height: 20 };
    expect(groundTarget({ chosen: MUTE, box, elements: ELEMENTS })).toBe(SLIDER);
  });

  it("snaps a box-only answer to the control under it", () => {
    const box = { x: 1365, y: 872, width: 30, height: 25 };
    expect(groundTarget({ box, elements: ELEMENTS })).toBe(MUTE);
  });

  it("finds nothing for a box over no control", () => {
    expect(groundTarget({ box: { x: 5000, y: 5000, width: 10, height: 10 }, elements: ELEMENTS })).toBeUndefined();
  });
});
