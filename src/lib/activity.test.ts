import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOME_SELECTED } from "../features/hode/test-fixtures";
import type { PerceptionAdapter } from "../providers/interfaces";
import { ACTIVITY_LINGER_MS, ActivityTracker, activeChannels, mirrorRemoteActivity, screenWatch, trackRemote, withScreenActivity } from "./activity";
import { LocalBus } from "./bus";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ActivityTracker", () => {
  it("lights a channel while work runs and lingers briefly after", () => {
    const tracker = new ActivityTracker();
    const end = tracker.begin("screen");
    expect(activeChannels(tracker.current())).toEqual(["screen"]);
    end();
    expect(tracker.current().screen).toBe(true);
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().screen).toBe(false);
  });

  it("stays on while overlapping work is still running", () => {
    const tracker = new ActivityTracker();
    const first = tracker.begin("screen");
    const second = tracker.begin("screen");
    first();
    first();
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS * 2);
    expect(tracker.current().screen).toBe(true);
    second();
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().screen).toBe(false);
  });

  it("notifies only on changes", () => {
    const tracker = new ActivityTracker();
    const listener = vi.fn();
    tracker.subscribe(listener);
    const a = tracker.begin("mic");
    const b = tracker.begin("mic");
    expect(listener).toHaveBeenCalledTimes(1);
    a();
    b();
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("ends tracked work even when it fails", async () => {
    const tracker = new ActivityTracker();
    await expect(tracker.track("cloud", () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().cloud).toBe(false);
  });
});

describe("withScreenActivity", () => {
  it("shows the green dot during every observation", async () => {
    const tracker = new ActivityTracker();
    let release: () => void = () => undefined;
    const perception: PerceptionAdapter = {
      observe: () => new Promise((resolve) => (release = () => resolve(HOME_SELECTED))),
      onLearnerAction: () => () => undefined,
    };
    const pending = withScreenActivity(perception, tracker).observe();
    expect(tracker.current().screen).toBe(true);
    release();
    await pending;
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().screen).toBe(false);
  });
});

describe("screenWatch", () => {
  it("holds the green dot steady while Hodey watches, instead of blinking at every keystroke", () => {
    vi.useFakeTimers();
    const tracker = new ActivityTracker();
    const watch = screenWatch(tracker);
    watch(true);
    watch(true);
    expect(tracker.current().screen).toBe(true);
    watch(false);
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().screen).toBe(false);
    vi.useRealTimers();
  });

  it("no longer flashes for each learner action on its own", () => {
    const tracker = new ActivityTracker();
    let act: (o: typeof HOME_SELECTED) => void = () => undefined;
    const perception: PerceptionAdapter = { observe: async () => HOME_SELECTED, onLearnerAction: (h) => ((act = h), () => undefined) };
    withScreenActivity(perception, tracker).onLearnerAction(() => undefined);
    act(HOME_SELECTED);
    expect(tracker.current().screen).toBe(false);
  });
});

describe("remote activity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lights the notch's dots for work done in another window, until it settles", async () => {
    const bus = new LocalBus();
    const tracker = new ActivityTracker();
    mirrorRemoteActivity(bus, tracker);
    let finish: (value: string) => void = () => undefined;
    const work = trackRemote(bus, "screen", () => new Promise<string>((resolve) => (finish = resolve)));
    expect(tracker.current().screen).toBe(true);
    finish("frame");
    expect(await work).toBe("frame");
    vi.advanceTimersByTime(ACTIVITY_LINGER_MS);
    expect(tracker.current().screen).toBe(false);
  });
});
