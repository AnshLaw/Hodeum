import { describe, expect, it } from "vitest";
import { bytesOf } from "./airplay-source";

describe("bytesOf", () => {
  it("accepts every shape a Tauri channel delivers raw bytes in", () => {
    expect(Array.from(bytesOf(new Uint8Array([1, 2]).buffer) ?? [])).toEqual([1, 2]);
    expect(Array.from(bytesOf(new Uint8Array([0, 3, 4]).subarray(1)) ?? [])).toEqual([3, 4]);
    expect(Array.from(bytesOf([5, 6]) ?? [])).toEqual([5, 6]);
  });

  it("leaves status messages alone", () => {
    expect(bytesOf({ state: "waiting" })).toBeUndefined();
  });
});
