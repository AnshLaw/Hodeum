import { COPY } from "../lib/copy";
import type { ScreenObservation } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

/**
 * Placeholder until native UI Automation lands (sub-project 2). Fails loudly so the notch shows a
 * recoverable error instead of pretending to see the screen.
 */
export class UnavailablePerception implements PerceptionAdapter {
  async observe(): Promise<ScreenObservation> {
    throw new Error(COPY.screenNotConnected);
  }

  onLearnerAction(): () => void {
    return () => undefined;
  }
}
