import type { LearnerInput, PerformRequest, Rect, ScreenObservation } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

/** Must match `LEARNER_ACTION_EVENT` in src-tauri/src/perception/input_hook.rs. */
export const LEARNER_ACTION_EVENT = "perception:learner-action";

/** The slice of Tauri this adapter needs, injectable for tests. */
export interface NativeBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** The learner-action payload is the input hook's report: a list of `LearnerInput`. */
  listen(event: string, handler: (payload: unknown) => void): () => void;
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
  /** Input reported since the last read started; attached to the next read. */
  private pending: LearnerInput[] = [];

  constructor(private readonly bridge: NativeBridge) {
    this.stopListening = bridge.listen(LEARNER_ACTION_EVENT, (payload) => this.onLearnerInput(payload));
  }

  observe(region?: Rect): Promise<ScreenObservation> {
    return this.bridge.invoke<ScreenObservation>("observe", { region: region ?? null });
  }

  async focusApp(app: string): Promise<boolean> {
    return (await this.bridge.invoke<{ title: string } | null>("focus_app", { app })) !== null;
  }

  /** Clicks the control through Windows, after checking it's still the one Hodey saw at those bounds. */
  perform({ target, button }: PerformRequest): Promise<void> {
    return this.bridge.invoke<void>("perform_click", { bounds: target.bounds, button });
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

  private onLearnerInput(payload?: unknown): void {
    if (!this.watching || this.handlers.size === 0) {
      this.pending = [];
      return;
    }
    this.pending.push(...parseInputs(payload));
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    const inputs = this.pending;
    this.pending = [];
    this.observe()
      .then(
        (observation) => this.handlers.forEach((handler) => handler(inputs.length > 0 ? { ...observation, inputs } : observation)),
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

const isPoint = (value: unknown): boolean =>
  typeof value === "object" && value !== null && typeof (value as { x?: unknown }).x === "number" && typeof (value as { y?: unknown }).y === "number";

function isInput(value: unknown): value is LearnerInput {
  if (typeof value !== "object" || value === null) return false;
  const input = value as { kind?: unknown; at?: unknown; button?: unknown };
  if (input.kind === "undo" || input.kind === "back") return true;
  return input.kind === "click" && isPoint(input.at) && (input.button === "left" || input.button === "right");
}

/** The hook's report; older builds sent nothing, which simply means no detail. */
function parseInputs(payload: unknown): LearnerInput[] {
  if (payload === undefined || payload === null) return [];
  const items = Array.isArray(payload) ? payload : [payload];
  const valid = items.filter(isInput);
  if (valid.length !== items.length) console.error("Ignored a malformed learner input report", payload);
  return valid;
}
