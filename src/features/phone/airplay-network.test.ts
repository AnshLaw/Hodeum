import { describe, expect, it } from "vitest";
import { COPY } from "../../lib/copy";
import { airplayGuide } from "./airplay-network";

describe("airplayGuide", () => {
  it("has the iPhone join the laptop hotspot before mirroring, and offers the cable and the shared Wi-Fi", () => {
    const guide = airplayGuide({ kind: "hotspot", ssid: "ANSHLAW 6986", passphrase: "k3y5pass" });
    expect(guide.steps).toEqual([COPY.phoneJoinHotspot("ANSHLAW 6986", "k3y5pass"), COPY.phoneMirrorToHodeum]);
    expect(guide.note).toBe(COPY.phoneUsbTip);
    expect(guide.switchTo).toEqual({ network: "wifi", label: COPY.phoneUseWifi });
  });

  it("only asks to mirror when the iPhone already shares its connection over the cable", () => {
    const guide = airplayGuide({ kind: "usb" });
    expect(guide.steps).toEqual([COPY.phoneUsbLinked, COPY.phoneMirrorToHodeum]);
    expect(guide.switchTo).toEqual({ network: "wifi", label: COPY.phoneUseWifi });
  });

  it("on the shared Wi-Fi, offers the direct link instead", () => {
    const guide = airplayGuide({ kind: "wifi", problem: null });
    expect(guide.steps).toEqual([COPY.phoneSameWifi, COPY.phoneMirrorToHodeum]);
    expect(guide.note).toBeUndefined();
    expect(guide.switchTo).toEqual({ network: "direct", label: COPY.phoneUseDirect });
  });

  it("says why the hotspot couldn't be used", () => {
    const guide = airplayGuide({ kind: "wifi", problem: "Turn on Wi-Fi so the laptop can host a Mobile hotspot." });
    expect(guide.note).toBe("Turn on Wi-Fi so the laptop can host a Mobile hotspot.");
    expect(guide.switchTo?.network).toBe("direct");
  });

  it("falls back to the plain instruction when the receiver didn't say where it is", () => {
    expect(airplayGuide(undefined)).toEqual({ steps: [COPY.phoneWaitingAirplay] });
  });
});
