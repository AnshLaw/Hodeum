import type { PerceptionAdapter } from "../providers/interfaces";
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

/** Every screen read lights the green dot. */
export function withScreenActivity(perception: PerceptionAdapter, activity: ActivityTracker): PerceptionAdapter {
  return {
    observe: (region?: Rect): Promise<ScreenObservation> => activity.track("screen", () => perception.observe(region)),
    onLearnerAction: (handler) =>
      perception.onLearnerAction((observation) => {
        // The adapter already re-read the screen to produce this observation: show it.
        activity.begin("screen")();
        handler(observation);
      }),
  };
}
