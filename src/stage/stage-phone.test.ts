import { describe, expect, it } from "vitest";
import { MAX_PHONE_SIDE } from "../features/phone/frame-math";
import { PHONE_FRAME } from "./scenes/iphone";
import { STAGE_MIRROR_SIZE, stageFrameRect } from "./stage-phone";

describe("stage iPhone mirror", () => {
  it("draws frames under the frame cap, so frame pixels aren't rescaled", () => {
    expect(Math.max(STAGE_MIRROR_SIZE.width, STAGE_MIRROR_SIZE.height)).toBeLessThanOrEqual(MAX_PHONE_SIDE);
    expect(STAGE_MIRROR_SIZE.width / STAGE_MIRROR_SIZE.height).toBeCloseTo(PHONE_FRAME.width / PHONE_FRAME.height);
  });

  it("maps the page phone's corners onto the mirrored frame's corners", () => {
    expect(stageFrameRect(PHONE_FRAME)).toEqual({ x: 0, y: 0, ...STAGE_MIRROR_SIZE });
    const row = stageFrameRect({ x: PHONE_FRAME.x + 16, y: PHONE_FRAME.y + 88, width: 248, height: 40 });
    const scale = STAGE_MIRROR_SIZE.width / PHONE_FRAME.width;
    expect(row).toEqual({ x: 16 * scale, y: 88 * scale, width: 248 * scale, height: 40 * scale });
  });
});
