import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import { initialState, type HodeState } from "../../features/hode/model";
import { PACK, guideAction } from "../../features/hode/test-fixtures";
import { notchView, skillLabel } from "./notch-view";

const guiding = (overrides: Partial<HodeState> = {}): HodeState => ({
  ...initialState,
  phase: "guiding",
  pack: PACK,
  action: guideAction(),
  ...overrides,
});

describe("notchView", () => {
  it("idle is a small pill offering Start a Hode and Point & Ask", () => {
    expect(notchView(initialState)).toMatchObject({ mode: "idle", size: "idle", title: "Hodey", controls: ["start", "point"] });
  });

  it("shows Hodey's instruction, step progress, and prerequisites on step one", () => {
    const view = notchView(guiding());
    expect(view).toMatchObject({ title: "Click Insert. I highlighted it.", eyebrow: "Step 1 of 2", detail: "Open the workbook.", hintLabel: COPY.hint });
    expect(view.controls).toContain("let_me_try");
  });

  it("only shows the objective when the learner is working unaided", () => {
    const view = notchView(guiding({ level: "observe", action: guideAction({ speech: "", assistanceLevel: "observe" }) }));
    expect(view.title).toBe("Your turn: Open the Insert tab");
    expect(view.hintLabel).toBe(COPY.needHint);
    expect(view.controls).not.toContain("let_me_try");
  });

  it("surfaces the failure message with recovery controls", () => {
    expect(notchView({ ...initialState, phase: "recovering", notice: "boom" })).toMatchObject({ mode: "error", detail: "boom", controls: ["retry", "end"] });
  });

  it("lists learned skills on success", () => {
    const view = notchView({ ...initialState, phase: "success", learnedSkills: ["excel.pivot.create"] });
    expect(view.skills).toEqual(["Pivot · Create"]);
  });
});

describe("skillLabel", () => {
  it("humanizes skill ids", () => {
    expect(skillLabel("excel.navigation.insert_tab")).toBe("Navigation · Insert tab");
  });
});
