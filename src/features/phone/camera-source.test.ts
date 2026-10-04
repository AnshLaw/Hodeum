import { describe, expect, it } from "vitest";
import { pickCamera } from "./camera-source";

const cams = [
  { deviceId: "a", label: "Integrated Webcam" },
  { deviceId: "b", label: "USB Video (534d:2109)" },
  { deviceId: "c", label: "iPhoneMirror Camera" },
];

describe("pickCamera", () => {
  it("prefers the camera the learner chose", () => {
    expect(pickCamera(cams, "USB Video (534d:2109)")?.deviceId).toBe("b");
  });

  it("otherwise picks one that looks like an iPhone or capture card", () => {
    expect(pickCamera(cams)?.deviceId).toBe("c");
    expect(pickCamera(cams.slice(0, 2))?.deviceId).toBe("b");
  });

  it("never guesses the laptop's own webcam: the learner must pick it", () => {
    expect(pickCamera(cams.slice(0, 1))).toBeUndefined();
    expect(pickCamera(cams.slice(0, 1), "Integrated Webcam")?.deviceId).toBe("a");
    expect(pickCamera([])).toBeUndefined();
  });
});
