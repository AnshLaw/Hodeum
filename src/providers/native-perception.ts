import type { Rect, ScreenObservation } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

/** Must match `LEARNER_ACTION_EVENT` in src-tauri/src/perception/input_hook.rs. */
export const LEARNER_ACTION_EVENT = "perception:learner-action";

/** The slice of Tauri this adapter needs, injectable for tests. */
export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen(event: string, handler: () => void): () => void;
}

/**
 * Windows UI Automation via the Rust side. Learner actions arrive as debounced native events;
 * the screen is only re-read for them while a Hode is watching, and never twice at once.
 */
export class NativePerception implements PerceptionAdapter {
  private readonly handlers = new Set<(observation: ScreenObservation) => void>();
  private readonly stopListening: () => void;
  private watching = false;
  private inFlight = false;
  private rerun = false;

  constructor(private readonly bridge: NativeBridge) {
    this.stopListening = bridge.listen(LEARNER_ACTION_EVENT, () => this.onLearnerInput());
  }

  observe(region?: Rect): Promise<ScreenObservation> {
    return this.bridge.invoke<ScreenObservation>("observe", { region: region ?? null });
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Only re-read after learner input while guidance is waiting on the learner. */
  setWatching(watching: boolean): void {
    this.watching = watching;
  }

  dispose(): void {
    this.stopListening();
    this.handlers.clear();
  }

  private onLearnerInput(): void {
    if (!this.watching || this.handlers.size === 0) return;
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    this.observe()
      .then(
        (observation) => this.handlers.forEach((handler) => handler(observation)),
        (error) => console.error("Couldn't read the screen after the learner's action", error),
      )
      .finally(() => {
        this.inFlight = false;
        if (this.rerun) {
          this.rerun = false;
          this.onLearnerInput();
        }
      });
  }
}
