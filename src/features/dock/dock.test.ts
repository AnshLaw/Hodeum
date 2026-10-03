import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, applyCommand, loadPrefs, reservesSpace, savePrefs, shouldReveal } from "./dock";

const storage = (value: string | null) => ({ getItem: () => value });

describe("dock preferences", () => {
  it("defaults to the top notch with auto-hide", () => {
    expect(loadPrefs(storage(null))).toEqual({ dock: "top", visibility: "auto" });
  });

  it("keeps valid fields and replaces invalid ones", () => {
    expect(loadPrefs(storage(JSON.stringify({ dock: "left", visibility: "sideways" })))).toEqual({ dock: "left", visibility: "auto" });
  });

  it("survives corrupt storage", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(loadPrefs(storage("{nope"))).toEqual(DEFAULT_PREFS);
    errorLog.mockRestore();
  });

  it("round-trips through storage", () => {
    let saved = "";
    savePrefs({ setItem: (_key, value) => (saved = value) }, { dock: "right", visibility: "pinned" });
    expect(loadPrefs(storage(saved))).toEqual({ dock: "right", visibility: "pinned" });
  });
});

describe("applyCommand", () => {
  const prefs = { dock: "top", visibility: "auto" } as const;

  it("hides, then shows again pinned", () => {
    const hidden = applyCommand(prefs, "toggle-visibility");
    expect(hidden.visibility).toBe("hidden");
    expect(applyCommand(hidden, "toggle-visibility").visibility).toBe("pinned");
  });

  it("moves the dock and changes visibility mode", () => {
    expect(applyCommand(prefs, "dock-right").dock).toBe("right");
    expect(applyCommand(prefs, "pinned").visibility).toBe("pinned");
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

  it("reserves screen space only for an active Hode on a side dock", () => {
    expect(reservesSpace("left", "guiding", "auto")).toBe(true);
    expect(reservesSpace("left", "idle", "pinned")).toBe(false);
    expect(reservesSpace("top", "guiding", "pinned")).toBe(false);
    expect(reservesSpace("right", "guiding", "hidden")).toBe(false);
  });
});
