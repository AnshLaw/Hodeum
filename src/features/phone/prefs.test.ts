import { describe, expect, it } from "vitest";
import { parsePhonePrefs } from "./prefs";

describe("parsePhonePrefs", () => {
  it("reads saved prefs", () => {
    expect(parsePhonePrefs('{"source":"airplay"}')).toEqual({ source: "airplay" });
    expect(parsePhonePrefs('{"source":"camera","cameraLabel":"USB Video"}')).toEqual({ source: "camera", cameraLabel: "USB Video" });
  });

  it("falls back to the camera source for missing or broken prefs", () => {
    expect(parsePhonePrefs(null)).toEqual({ source: "camera" });
    expect(parsePhonePrefs("{nope")).toEqual({ source: "camera" });
    expect(parsePhonePrefs('{"source":"bluetooth"}')).toEqual({ source: "camera" });
  });
});
