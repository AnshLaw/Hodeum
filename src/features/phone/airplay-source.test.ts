import { describe, expect, it } from "vitest";
import { bytesOf, receiverStatus } from "./airplay-source";

describe("receiverStatus", () => {
  it("passes on where the iPhone has to be while the receiver waits", () => {
    const network = { kind: "hotspot" as const, ssid: "LAPTOP", passphrase: "12345678" };
    expect(receiverStatus({ state: "waiting", network })).toEqual({ state: "waiting", network });
    expect(receiverStatus({ state: "waiting" })).toEqual({ state: "waiting", network: undefined });
  });

  it("turns a stopped receiver into an error with its reason", () => {
    expect(receiverStatus({ state: "failed", detail: "port in use" })).toEqual({ state: "error", message: "port in use" });
    expect(receiverStatus({ state: "failed", detail: null })).toEqual({ state: "error", message: "The AirPlay receiver stopped." });
  });

  it("leaves streaming to the decoder, which reports live once a frame shows", () => {
    expect(receiverStatus({ state: "streaming" })).toBeUndefined();
  });
});

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
