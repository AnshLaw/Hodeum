import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SIDEBAR_HOVER_GRACE_MS, createHoverGate, hoverGraceMs } from "./hover-gate";

describe("createHoverGate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("opens at once and closes only after the grace period", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(true);
    expect(changes).toEqual([true]);
    gate.set(false);
    vi.advanceTimersByTime(399);
    expect(changes).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true, false]);
  });

  it("rides out a stale hit area while the panel is still growing under the cursor", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(true);
    // The cursor outruns the animating panel, then the grown panel catches it again.
    gate.set(false);
    vi.advanceTimersByTime(100);
    gate.set(true);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true]);
  });

  it("doesn't restart the grace period on repeated leaves", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(true);
    gate.set(false);
    vi.advanceTimersByTime(300);
    gate.set(false);
    vi.advanceTimersByTime(100);
    expect(changes).toEqual([true, false]);
  });

  it("reports nothing when the state doesn't change", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(false);
    vi.advanceTimersByTime(1000);
    gate.set(true);
    gate.set(true);
    expect(changes).toEqual([true]);
  });

  it("closes immediately with no grace (the top notch)", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 0);
    gate.set(true);
    gate.set(false);
    expect(changes).toEqual([true, false]);
  });

  it("settles a pending close at once when disposed, so hover never sticks", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(true);
    gate.set(false);
    gate.dispose();
    expect(changes).toEqual([true, false]);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([true, false]);
  });

  it("starts from the hover it's handed, so leaving right after a re-dock still closes", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 0, true);
    gate.set(false);
    expect(changes).toEqual([false]);
  });

  it("keeps a live hover when disposed (re-docking under the cursor)", () => {
    const changes: boolean[] = [];
    const gate = createHoverGate((hovered) => changes.push(hovered), 400);
    gate.set(true);
    gate.dispose();
    expect(changes).toEqual([true]);
  });
});

describe("hoverGraceMs", () => {
  it("gives side docks a grace period longer than the panel's open animation, and the top notch none", () => {
    expect(hoverGraceMs("top")).toBe(0);
    expect(hoverGraceMs("left")).toBe(SIDEBAR_HOVER_GRACE_MS);
    expect(hoverGraceMs("right")).toBe(SIDEBAR_HOVER_GRACE_MS);
  });
});
