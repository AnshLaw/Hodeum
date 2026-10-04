import { describe, expect, it } from "vitest";
import { StageKeys, shortcutsFor } from "./keys";

describe("Hodey key shortcuts", () => {
  it("lists hold-to-talk and the one-letter commands for the chosen key", () => {
    expect(shortcutsFor("right-alt").map((s) => [s.keys.join(" + "), s.does])).toEqual([
      ["Right Alt", "Hold to talk to Hodey, let go to send"],
      ["Right Alt + P", "Point & Ask"],
      ["Right Alt + H", "Show or hide Hodey"],
      ["Right Alt + A", "Open the Hodeum app"],
    ]);
  });
});

describe("StageKeys (browser practice stage)", () => {
  const key = (code: string, type: "keydown" | "keyup" = "keydown") => ({ type, code });

  it("runs a command for the Hodey key plus a bound letter", () => {
    const keys = new StageKeys(() => "right-ctrl");
    expect(keys.handle(key("ControlRight"))).toBeUndefined();
    expect(keys.handle(key("KeyH"))).toBe("show-hide");
    expect(keys.handle(key("ControlRight", "keyup"))).toBeUndefined();
    expect(keys.handle(key("KeyH"))).toBeUndefined();
  });

  it("ignores the other Ctrl key", () => {
    const keys = new StageKeys(() => "right-ctrl");
    keys.handle(key("ControlLeft"));
    expect(keys.handle(key("KeyP"))).toBeUndefined();
  });
});
