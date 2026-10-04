import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, applyCommand, loadPrefs, notchWindow, reservesSpace, savePrefs, shouldReveal } from "./dock";

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

describe("applyCommand", () => {
  const prefs = { dock: "top", visibility: "auto", sidebar: "copilot" } as const;

  it("hides, then shows again pinned", () => {
    const hidden = applyCommand(prefs, "toggle-visibility");
    expect(hidden.visibility).toBe("hidden");
    expect(applyCommand(hidden, "toggle-visibility").visibility).toBe("pinned");
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

  it("a copilot sidebar reserves space while pinned, or under auto-hide while a Hode runs", () => {
    const copilot = { dock: "left", visibility: "auto", sidebar: "copilot" } as const;
    expect(reservesSpace(copilot, "guiding")).toBe(true);
    expect(reservesSpace(copilot, "idle")).toBe(false);
    expect(reservesSpace({ ...copilot, visibility: "pinned" }, "idle")).toBe(true);
    expect(reservesSpace({ ...copilot, visibility: "hidden" }, "guiding")).toBe(false);
    expect(reservesSpace({ ...copilot, dock: "top" }, "guiding")).toBe(false);
  });

  it("a floating sidebar never reserves space", () => {
    expect(reservesSpace({ dock: "right", visibility: "pinned", sidebar: "floating" }, "guiding")).toBe(false);
  });
});

describe("notchWindow while the Hodeum app is open", () => {
  const copilot = { dock: "left", visibility: "pinned", sidebar: "copilot" } as const;

  it("hides the notch and gives back its screen space while the app is open", () => {
    expect(notchWindow(copilot, "guiding", "open")).toEqual({ visible: false, reserve: false });
  });

  it("shows the notch as the app folds back, but reserves space only once it's gone", () => {
    expect(notchWindow(copilot, "guiding", "closing")).toEqual({ visible: true, reserve: false });
    expect(notchWindow(copilot, "guiding", "closed")).toEqual({ visible: true, reserve: true });
  });

  it("restores the learner's own choice afterwards, including a hidden notch", () => {
    expect(notchWindow({ ...copilot, visibility: "hidden" }, "idle", "closed")).toEqual({ visible: false, reserve: false });
    expect(notchWindow({ ...copilot, visibility: "hidden" }, "idle", "closing")).toEqual({ visible: false, reserve: false });
    expect(notchWindow({ ...copilot, dock: "top" }, "idle", "closed")).toEqual({ visible: true, reserve: false });
  });
});
