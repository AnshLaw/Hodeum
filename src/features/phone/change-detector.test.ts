import { describe, expect, it } from "vitest";
import { ChangeDetector, SETTLE_MS } from "./change-detector";

const SIZE = 32 * 64;
const flat = (value: number) => new Uint8Array(SIZE).fill(value);
const STEP_MS = 250;

describe("ChangeDetector", () => {
  it("fires once when the screen changes and then holds still", () => {
    const d = new ChangeDetector();
    let t = 0;
    expect(d.push(flat(200), t)).toBe(false);
    expect(d.push(flat(30), (t += STEP_MS))).toBe(false);
    const fired: boolean[] = [];
    for (let elapsed = 0; elapsed <= SETTLE_MS + STEP_MS; elapsed += STEP_MS) fired.push(d.push(flat(30), (t += STEP_MS)));
    expect(fired.filter(Boolean)).toHaveLength(1);
  });

  it("ignores noise like the clock ticking", () => {
    const d = new ChangeDetector();
    d.push(flat(200), 0);
    const noisy = flat(200);
    noisy[0] = 0;
    let fired = false;
    for (let t = STEP_MS; t < SETTLE_MS * 4; t += STEP_MS) fired ||= d.push(noisy, t);
    expect(fired).toBe(false);
  });

  it("does not fire when the screen returns to where it was", () => {
    const d = new ChangeDetector();
    d.push(flat(200), 0);
    d.push(flat(30), STEP_MS);
    let fired = false;
    for (let t = STEP_MS * 2; t < SETTLE_MS * 4; t += STEP_MS) fired ||= d.push(flat(200), t);
    expect(fired).toBe(false);
  });
});
