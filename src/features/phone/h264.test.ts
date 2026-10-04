import { describe, expect, it } from "vitest";
import { avcCodec, findSps } from "./h264";

const SC = [0, 0, 0, 1];

describe("h264", () => {
  it("finds the SPS NAL in an Annex-B access unit", () => {
    const unit = new Uint8Array([...SC, 0x67, 0x64, 0x00, 0x28, 0xac, ...SC, 0x68, 0xee, ...SC, 0x65, 0x88]);
    expect(Array.from(findSps(unit) ?? [])).toEqual([0x67, 0x64, 0x00, 0x28, 0xac]);
  });

  it("returns undefined without an SPS (a delta frame)", () => {
    expect(findSps(new Uint8Array([...SC, 0x41, 0x9a]))).toBeUndefined();
  });

  it("builds the WebCodecs codec string from profile, constraints and level", () => {
    expect(avcCodec(new Uint8Array([0x67, 0x64, 0x00, 0x28]))).toBe("avc1.640028");
    expect(avcCodec(new Uint8Array([0x67, 0x42, 0xe0, 0x1f]))).toBe("avc1.42e01f");
  });
});
