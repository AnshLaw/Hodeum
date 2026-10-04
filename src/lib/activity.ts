import type { PerceptionAdapter } from "../providers/interfaces";
import type { Bus } from "./bus";
import type { Rect, ScreenObservation } from "./types";

/** What Hodey is touching right now, shown as privacy dots (like iPhone's Dynamic Island). */
export type ActivityChannel = "screen" | "mic" | "cloud";
export type ActivityState = Record<ActivityChannel, boolean>;

/** Brief reads (~50 ms UI Automation walks) still show a visible blip. */
export const ACTIVITY_LINGER_MS = 600;
const CHANNELS: ActivityChannel[] = ["screen", "mic", "cloud"];
const IDLE: ActivityState = { screen: false, mic: false, cloud: false };

export class ActivityTracker {
  private readonly counts: Record<ActivityChannel, number> = { screen: 0, mic: 0, cloud: 0 };
  private readonly lingerTimers: Partial<Record<ActivityChannel, ReturnType<typeof setTimeout>>> = {};
  private readonly listeners = new Set<(state: ActivityState) => void>();
  private state: ActivityState = IDLE;

  /** Marks the channel active until the returned function is called (safe to call twice). */
  begin(channel: ActivityChannel): () => void {
    this.counts[channel] += 1;
    clearTimeout(this.lingerTimers[channel]);
    this.publish(channel, true);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.counts[channel] -= 1;
      if (this.counts[channel] > 0) return;
      this.lingerTimers[channel] = setTimeout(() => this.publish(channel, false), ACTIVITY_LINGER_MS);
    };
  }

  /** Runs `work` with the channel marked active, ending it however the work settles. */
  async track<T>(channel: ActivityChannel, work: () => Promise<T>): Promise<T> {
    const end = this.begin(channel);
    try {
      return await work();
    } finally {
      end();
    }
  }

  current(): ActivityState {
    return this.state;
  }

  subscribe(listener: (state: ActivityState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(channel: ActivityChannel, active: boolean): void {
    if (this.state[channel] === active) return;
    this.state = { ...this.state, [channel]: active };
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export function activeChannels(state: ActivityState): ActivityChannel[] {
  return CHANNELS.filter((channel) => state[channel]);
}

/**
 * Every screen read Hodey asks for lights the green dot. Reads after the learner's own actions happen only
 * while Hodey watches, which `screenWatch` shows as one steady dot rather than a blink per keystroke.
 */
export function withScreenActivity(perception: PerceptionAdapter, activity: ActivityTracker): PerceptionAdapter {
  const { shellTargets } = perception;
  return {
    observe: (region?: Rect, want?: string[]): Promise<ScreenObservation> => activity.track("screen", () => perception.observe(region, want)),
    setWanted: perception.setWanted?.bind(perception),
    focusApp: perception.focusApp?.bind(perception),
    launchApp: perception.launchApp?.bind(perception),
    onAppSwitched: perception.onAppSwitched?.bind(perception),
    openInstalledApp: perception.openInstalledApp?.bind(perception),
    shellTargets: shellTargets && (() => activity.track("screen", () => shellTargets.call(perception))),
    perform: perception.perform?.bind(perception),
    onLearnerAction: (handler) => perception.onLearnerAction(handler),
  };
}

/** Holds the green dot on while Hodey watches the learner's screen; call with false when it stops. */
export function screenWatch(activity: ActivityTracker): (watching: boolean) => void {
  let end: (() => void) | undefined;
  return (watching) => {
    if (watching && !end) end = activity.begin("screen");
    if (!watching && end) {
      end();
      end = undefined;
    }
  };
}

/** Runs `work` in another window (the app) while the notch, which owns the dots, shows the channel. */
export async function trackRemote<T>(bus: Bus, channel: ActivityChannel, work: () => Promise<T>): Promise<T> {
  const id = crypto.randomUUID();
  bus.emit("activity:remote", { id, channel, active: true });
  try {
    return await work();
  } finally {
    bus.emit("activity:remote", { id, channel, active: false });
  }
}

/** The notch side of `trackRemote`. Returns a disposer. */
export function mirrorRemoteActivity(bus: Bus, tracker: ActivityTracker): () => void {
  const ends = new Map<string, () => void>();
  return bus.on("activity:remote", ({ id, channel, active }) => {
    if (active) {
      ends.set(id, tracker.begin(channel));
      return;
    }
    ends.get(id)?.();
    ends.delete(id);
  });
}
