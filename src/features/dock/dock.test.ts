import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, applyCommand, holdsSpace, loadPrefs, notchWindow, reservesSpace, savePrefs, seedPrefs, shouldReveal } from "./dock";

const storage = (value: string | null) => ({ getItem: () => value });

describe("dock preferences", () => {
  it("defaults to the top notch with auto-hide", () => {
    expect(loadPrefs(storage(null))).toEqual({ dock: "top", visibility: "auto", sidebar: "copilot" });
  });

  it("keeps valid fields and replaces invalid ones", () => {
    expect(loadPrefs(storage(JSON.stringify({ dock: "left", visibility: "sideways" })))).toEqual({ dock: "left", visibility: "auto", sidebar: "copilot" });
  });

  it("survives corrupt storage", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(loadPrefs(storage("{nope"))).toEqual(DEFAULT_PREFS);
    errorLog.mockRestore();
  });

  it("round-trips through storage", () => {
    let saved = "";
    savePrefs({ setItem: (_key, value) => (saved = value) }, { dock: "right", visibility: "pinned", sidebar: "floating" });
    expect(loadPrefs(storage(saved))).toEqual({ dock: "right", visibility: "pinned", sidebar: "floating" });
  });
});

describe("seedPrefs", () => {
  const memory = (initial: string | null) => {
    let value = initial;
    return { getItem: () => value, setItem: (_key: string, next: string) => (value = next) };
  };

  it("writes starting preferences when nothing is saved", () => {
    const store = memory(null);
    seedPrefs(store, { ...DEFAULT_PREFS, visibility: "pinned" });
    expect(loadPrefs(store).visibility).toBe("pinned");
  });

  it("never overwrites the learner's own choice", () => {
    const store = memory(JSON.stringify({ dock: "left", visibility: "auto", sidebar: "floating" }));
    seedPrefs(store, { ...DEFAULT_PREFS, visibility: "pinned" });
    expect(loadPrefs(store)).toEqual({ dock: "left", visibility: "auto", sidebar: "floating" });
  });
});

describe("applyCommand", () => {
  const prefs = { dock: "top", visibility: "auto", sidebar: "copilot" } as const;

  it("hides, then shows again the way it was shown before, so auto-hide survives a Hide", () => {
    const hidden = applyCommand(prefs, "toggle-visibility");
    expect(hidden.visibility).toBe("hidden");
    expect(applyCommand(hidden, "toggle-visibility")).toEqual(prefs);
    const pinned = applyCommand(applyCommand({ ...prefs, visibility: "pinned" }, "toggle-visibility"), "toggle-visibility");
    expect(pinned.visibility).toBe("pinned");
  });

  it("shows a hidden notch and leaves a visible one as it is (tray icon click)", () => {
    expect(applyCommand(applyCommand(prefs, "toggle-visibility"), "show")).toEqual(prefs);
    expect(applyCommand({ ...prefs, visibility: "hidden" }, "show").visibility).toBe("auto");
    expect(applyCommand(prefs, "show")).toEqual(prefs);
    expect(applyCommand({ ...prefs, visibility: "pinned" }, "show").visibility).toBe("pinned");
  });

  it("moves the dock and changes visibility mode", () => {
    expect(applyCommand(prefs, "dock-right").dock).toBe("right");
    expect(applyCommand(prefs, "pinned").visibility).toBe("pinned");
    expect(applyCommand(prefs, "sidebar-floating").sidebar).toBe("floating");
  });

  it("ignores unknown commands", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(applyCommand(prefs, "explode")).toBe(prefs);
    errorLog.mockRestore();
  });
});

describe("visibility rules", () => {
  it("pinned is always shown and hidden never is", () => {
    expect(shouldReveal("pinned", false, "idle")).toBe(true);
    expect(shouldReveal("hidden", true, "guiding")).toBe(false);
  });

  it("auto-hide reveals on hover or whenever a Hode is running", () => {
    expect(shouldReveal("auto", false, "idle")).toBe(false);
    expect(shouldReveal("auto", true, "idle")).toBe(true);
    expect(shouldReveal("auto", false, "guiding")).toBe(true);
  });

  it("auto-hide tucks a paused Hode away like a sleeping Hodey; hovering brings it back", () => {
    expect(shouldReveal("auto", false, "paused")).toBe(false);
    expect(shouldReveal("auto", true, "paused")).toBe(true);
  });

  it("a copilot sidebar reserves space while pinned, or under auto-hide while a Hode runs", () => {
    const copilot = { dock: "left", visibility: "auto", sidebar: "copilot" } as const;
    expect(reservesSpace(copilot, true)).toBe(true);
    expect(reservesSpace(copilot, false)).toBe(false);
    expect(reservesSpace({ ...copilot, visibility: "pinned" }, false)).toBe(true);
    expect(reservesSpace({ ...copilot, visibility: "hidden" }, true)).toBe(false);
    expect(reservesSpace({ ...copilot, dock: "top" }, true)).toBe(false);
  });

  it("a floating sidebar never reserves space", () => {
    expect(reservesSpace({ dock: "right", visibility: "pinned", sidebar: "floating" }, true)).toBe(false);
  });
});

describe("holdsSpace", () => {
  const pack = { id: "excel-pivot" };

  it("holds the strip for a Hode, from the goal form to the success card", () => {
    expect(holdsSpace({ phase: "goal_entry", open: false })).toBe(true);
    expect(holdsSpace({ phase: "observing", pack, open: false })).toBe(true);
    expect(holdsSpace({ phase: "guiding", open: true })).toBe(true);
    expect(holdsSpace({ phase: "success", pack, open: false })).toBe(true);
  });

  it("keeps holding while the learner asks a question mid-Hode", () => {
    for (const phase of ["annotating", "observing", "reasoning", "answering"] as const) {
      expect(holdsSpace({ phase, pack, open: false, resumePhase: "observing" })).toBe(true);
    }
  });

  it("never reflows windows for a one-off Point & Ask or spoken question from idle", () => {
    for (const phase of ["annotating", "observing", "reasoning", "answering"] as const) {
      expect(holdsSpace({ phase, open: false, resumePhase: "idle" })).toBe(false);
    }
  });

  it("keeps a goal being typed when the learner points at something first", () => {
    expect(holdsSpace({ phase: "annotating", open: false, resumePhase: "goal_entry" })).toBe(true);
  });

  it("releases once idle", () => {
    expect(holdsSpace({ phase: "idle", pack, open: false })).toBe(false);
  });
});

describe("notchWindow while the Hodeum app is open", () => {
  const copilot = { dock: "left", visibility: "pinned", sidebar: "copilot" } as const;

  it("hides the notch and gives back its screen space while the app is open", () => {
    expect(notchWindow(copilot, true, "open")).toEqual({ visible: false, reserve: false });
  });

  it("shows the notch as the app folds back, but reserves space only once it's gone", () => {
    expect(notchWindow(copilot, true, "closing")).toEqual({ visible: true, reserve: false });
    expect(notchWindow(copilot, true, "closed")).toEqual({ visible: true, reserve: true });
  });

  it("comes out over the app while the app searches the web, unless the learner hid it", () => {
    expect(notchWindow(copilot, false, "open", true)).toEqual({ visible: true, reserve: false });
    expect(notchWindow({ ...copilot, visibility: "hidden" }, false, "open", true)).toEqual({ visible: false, reserve: false });
  });

  it("restores the learner's own choice afterwards, including a hidden notch", () => {
    expect(notchWindow({ ...copilot, visibility: "hidden" }, false, "closed")).toEqual({ visible: false, reserve: false });
    expect(notchWindow({ ...copilot, visibility: "hidden" }, false, "closing")).toEqual({ visible: false, reserve: false });
    expect(notchWindow({ ...copilot, dock: "top" }, false, "closed")).toEqual({ visible: true, reserve: false });
  });
});
