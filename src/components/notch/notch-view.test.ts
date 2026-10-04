import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import { initialState, type HodeState } from "../../features/hode/model";
import { PACK, guideAction } from "../../features/hode/test-fixtures";
import { NOTCH_WIDTHS, isExpanded, islandSize, notchView, providerBadge, shouldPeek, skillLabel, stepItems, voiceNotice } from "./notch-view";

const guiding = (overrides: Partial<HodeState> = {}): HodeState => ({
  ...initialState,
  mode: "agent",
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
    expect(view).toMatchObject({ title: "Click Insert. I highlighted it.", eyebrow: "Step 1 of 2 · Agent · Guide me", detail: "Open the workbook.", hintLabel: COPY.hint });
    expect(view.controls).toContain("let_me_try");
  });

  it("only shows the objective when the learner is working unaided", () => {
    const view = notchView(guiding({ level: "observe", action: guideAction({ speech: "", assistanceLevel: "observe" }) }));
    expect(view.title).toBe("Your turn: Open the Insert tab");
    expect(view.hintLabel).toBe(COPY.needHint);
    expect(view.controls).not.toContain("let_me_try");
  });

  it("shows what Hodey is clicking, with time to take over, in Do it for me", () => {
    const view = notchView(guiding({ phase: "acting", agentStyle: "execute" }));
    expect(view).toMatchObject({ title: COPY.acting("Insert", false), eyebrow: "Step 1 of 2 · Agent · Do it for me", busy: true, controls: ["take_over", "pause", "end"] });
  });

  it("asks the learner to check Hodey's work at a checkpoint", () => {
    const view = notchView(guiding({ phase: "checkpoint", agentStyle: "execute", stepIndex: 1, action: undefined }));
    expect(view).toMatchObject({ title: COPY.checkpointTitle, detail: COPY.checkpointDetail(PACK.steps[0].objective), controls: ["approve", "take_over", "point", "end"] });
  });

  it("says Hodey did the clicking when no skill was the learner's", () => {
    expect(notchView({ ...initialState, phase: "success", hodeyDid: 2 }).detail).toBe(COPY.hodeyDidIt);
    expect(notchView({ ...initialState, phase: "success", hodeyDid: 1, learnedSkills: ["excel.pivot.create"] }).detail).toBe(COPY.skillLearned);
  });

  it("surfaces the failure message with recovery controls", () => {
    expect(notchView({ ...initialState, phase: "recovering", notice: "boom" })).toMatchObject({ mode: "error", detail: "boom", controls: ["retry", "look_again", "end"] });
  });

  it("lists learned skills on success", () => {
    const view = notchView({ ...initialState, phase: "success", learnedSkills: ["excel.pivot.create"] });
    expect(view.skills).toEqual(["Pivot · Create"]);
  });
});

describe("modes in the notch", () => {
  it("help mode stands by without spelling out the step", () => {
    const view = notchView(guiding({ mode: "help", level: "observe", action: guideAction({ speech: "", assistanceLevel: "observe" }) }));
    expect(view).toMatchObject({ title: COPY.helpStandingBy, eyebrow: "Step 1 of 2 · Help" });
    expect(view.controls[0]).toBe("hint");
    expect(view.controls).not.toContain("let_me_try");
    expect(view.controls).not.toContain("all_steps");
  });

  it("teach mode offers to show the whole flow, and lists it only when asked", () => {
    const view = notchView(guiding({ mode: "teach", level: "hint" }));
    expect(view.eyebrow).toBe("Step 1 of 2 · Teach");
    expect(view.controls).toContain("all_steps");
    expect(view.steps).toBeUndefined();
    expect(notchView(guiding({ mode: "teach", showAllSteps: true })).steps).toHaveLength(2);
  });

  it("agent mode shows the whole flow without being asked", () => {
    const view = notchView(guiding({ mode: "agent" }));
    expect(view.steps?.map((s) => s.state)).toEqual(["current", "todo"]);
    expect(view.controls).not.toContain("all_steps");
  });
});

describe("spoken answers", () => {
  it("shows the learner's question above Hodey's answer, like a chat", () => {
    const view = notchView({ ...initialState, phase: "answering", spokenQuestion: "what does the green button do", action: guideAction({ kind: "answer", speech: "It saves your work." }) });
    expect(view).toMatchObject({ eyebrow: "You: “what does the green button do”", title: "It saves your work." });
  });
});

describe("islandSize", () => {
  const looking = notchView({ ...initialState, phase: "reasoning" });
  const quiet = { settled: true, hovered: false, menuOpen: false, peek: false, listening: false, phone: false };

  it("shrinks to an orb while Hodey looks, keeping the status as its label", () => {
    expect(looking).toMatchObject({ size: "orb", busy: true, title: COPY.looking });
    expect(islandSize(looking, quiet)).toBe("orb");
  });

  it("stays a bar for brief work, on hover, and with the menu open", () => {
    expect(islandSize(looking, { ...quiet, settled: false })).toBe("compact");
    expect(islandSize(looking, { ...quiet, hovered: true })).toBe("compact");
    expect(islandSize(looking, { ...quiet, menuOpen: true })).toBe("lesson");
  });

  it("opens into a bar while listening, so the learner sees what Hodey hears", () => {
    expect(islandSize(notchView(initialState), { ...quiet, listening: true })).toBe("compact");
    expect(islandSize(looking, { ...quiet, listening: true })).toBe("compact");
    expect(islandSize(notchView(guiding()), { ...quiet, listening: true })).toBe("guidance");
  });

  it("steps aside to a bar while guidance covers the target", () => {
    expect(islandSize(notchView(guiding()), { ...quiet, peek: true })).toBe("compact");
    expect(islandSize(notchView(guiding()), quiet)).toBe("guidance");
  });
});

describe("skillLabel", () => {
  it("humanizes skill ids", () => {
    expect(skillLabel("excel.navigation.insert_tab")).toBe("Navigation · Insert tab");
  });
});

describe("stepItems", () => {
  it("is empty without a Hode", () => {
    expect(stepItems(initialState)).toEqual([]);
  });

  it("keeps upcoming steps hidden in teach mode until asked, and the list away in help mode", () => {
    expect(stepItems(guiding({ mode: "teach" })).map((s) => s.state)).toEqual(["current"]);
    expect(stepItems(guiding({ mode: "teach", showAllSteps: true })).map((s) => s.state)).toEqual(["current", "todo"]);
    expect(stepItems(guiding({ mode: "help" }))).toEqual([]);
  });

  it("marks finished, current, and upcoming steps", () => {
    expect(stepItems(guiding({ stepIndex: 1 })).map((s) => s.state)).toEqual(["done", "current"]);
    expect(stepItems({ ...guiding(), phase: "success" }).map((s) => s.state)).toEqual(["done", "done"]);
  });
});

describe("phone island", () => {
  const context = { settled: true, hovered: false, menuOpen: false, peek: false, listening: false, phone: true };

  it("opens to the phone layout while the mirror is open", () => {
    expect(islandSize(notchView(initialState), context)).toBe("phone");
  });

  it("still lets the menu take over", () => {
    expect(islandSize(notchView(initialState), { ...context, menuOpen: true })).toBe("lesson");
  });
});

describe("skills island", () => {
  const context = { settled: true, hovered: false, menuOpen: false, peek: false, listening: false, phone: false, skills: true };

  it("opens to the skills layout, wider than a guidance card, over any Hode", () => {
    expect(islandSize(notchView(initialState), context)).toBe("skills");
    expect(islandSize(notchView(guiding()), { ...context, peek: true })).toBe("skills");
    expect(NOTCH_WIDTHS.skills).toBeGreaterThan(NOTCH_WIDTHS.guidance);
    expect(isExpanded({ ...notchView(initialState), size: "skills" })).toBe(true);
  });

  it("gives way to the menu and covers the phone mirror", () => {
    expect(islandSize(notchView(initialState), { ...context, menuOpen: true })).toBe("lesson");
    expect(islandSize(notchView(initialState), { ...context, phone: true })).toBe("skills");
  });
});

describe("providerBadge", () => {
  it("says Local unless a cloud provider may receive context", () => {
    expect(providerBadge(false)).toEqual({ label: COPY.local, title: COPY.localTitle, variant: "local" });
    expect(providerBadge(true)).toEqual({ label: COPY.enhanced, title: COPY.enhancedTitle, variant: "enhanced" });
  });
});

describe("voiceNotice", () => {
  it("says so when Hodey's natural voice isn't installed, instead of quietly sounding robotic", () => {
    expect(voiceNotice("missing")).toBe(COPY.naturalVoiceMissing);
    expect(voiceNotice("ready")).toBeUndefined();
    expect(voiceNotice("loading")).toBeUndefined();
    expect(voiceNotice(undefined)).toBeUndefined();
  });
});

describe("shouldPeek", () => {
  const covered = { covering: true, hovered: false, menuOpen: false, skillsOpen: false };

  it("steps aside while a guidance step's target is under the card", () => {
    expect(shouldPeek({ ...covered, mode: "guidance" })).toBe(true);
  });

  it("steps aside for a Point & Ask answer too: its highlight sat under the card before", () => {
    expect(shouldPeek({ ...covered, mode: "answer" })).toBe(true);
  });

  it("stays open while the learner hovers it, uses the menu or reads their skills", () => {
    expect(shouldPeek({ ...covered, mode: "guidance", hovered: true })).toBe(false);
    expect(shouldPeek({ ...covered, mode: "guidance", menuOpen: true })).toBe(false);
    expect(shouldPeek({ ...covered, mode: "guidance", skillsOpen: true })).toBe(false);
  });

  it("never peeks when nothing is covered, or for cards without a highlight (success, errors, goal entry)", () => {
    expect(shouldPeek({ ...covered, mode: "guidance", covering: false })).toBe(false);
    expect(shouldPeek({ ...covered, mode: "success" })).toBe(false);
    expect(shouldPeek({ ...covered, mode: "goal" })).toBe(false);
  });
});
