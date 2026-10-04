import { describe, expect, it } from "vitest";
import { parsePhonePrefs } from "./prefs";

describe("parsePhonePrefs", () => {
  it("reads saved prefs", () => {
    expect(parsePhonePrefs('{"source":"airplay"}')).toEqual({ source: "airplay" });
    expect(parsePhonePrefs('{"source":"camera","cameraLabel":"USB Video"}')).toEqual({ source: "camera", cameraLabel: "USB Video" });
  });

  it("remembers which network AirPlay uses", () => {
    expect(parsePhonePrefs('{"source":"airplay","airplayNetwork":"wifi"}')).toEqual({ source: "airplay", airplayNetwork: "wifi" });
    expect(parsePhonePrefs('{"source":"airplay","airplayNetwork":"direct"}')).toEqual({ source: "airplay", airplayNetwork: "direct" });
  });

  it("falls back to AirPlay for missing or broken prefs", () => {
    expect(parsePhonePrefs(null)).toEqual({ source: "airplay" });
    expect(parsePhonePrefs("{nope")).toEqual({ source: "airplay" });
    expect(parsePhonePrefs('{"source":"bluetooth"}')).toEqual({ source: "airplay" });
  });
});
