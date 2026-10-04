import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../data/settings";
import { appearanceVars, localVoices, resolveTheme } from "./appearance";

describe("appearance", () => {
  it("maps the accent and Hodey's colour to CSS variables", () => {
    const vars = appearanceVars({ ...DEFAULT_SETTINGS.appearance, accent: "sky", hodeyColor: "violet" });
    expect(vars["--hd-accent"]).toBe("#4cb8ff");
    expect(vars["--hd-hodey-skin"]).toBe("#b49cff");
  });

  it("pairs each accent with a companion hue for the highlight beam", () => {
    const sky = appearanceVars({ ...DEFAULT_SETTINGS.appearance, accent: "sky" });
    const amber = appearanceVars({ ...DEFAULT_SETTINGS.appearance, accent: "amber" });
    expect(sky["--hd-beam"]).toBe("#a78bfa");
    expect(amber["--hd-beam"]).not.toBe(amber["--hd-accent"]);
  });

  it("follows the system theme only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("offers only voices that run on this PC", () => {
    const voices = [
      { name: "Microsoft Aria Online (Natural)", voiceURI: "aria", lang: "en-US", localService: false },
      { name: "Microsoft Zira", voiceURI: "zira", lang: "en-US", localService: true },
      { name: "Microsoft Hemant", voiceURI: "hemant", lang: "hi-IN", localService: true },
    ];
    expect(localVoices(voices).map((v) => v.voiceURI)).toEqual(["zira", "hemant"]);
  });
});
