import { recordFor } from "../../data/recorder";
import type { HodeOutcome } from "../../data/types";
import type { AssistanceLevel } from "../../lib/types";
import type { LearningMemory, MemoryProvider } from "../../providers/interfaces";
import type { HodeEvent, HodeState } from "../hode/model";
import { finishedStep, summarize, type StepTrace } from "./summary";

/** `recordFor` needs an id to report a Hode's end; memory only tracks one Hode at a time. */
const TRACKED_HODE = "current";

/** The level the most recent memory of `skillId` says to start at (memories come newest first). */
export function rememberedLevel(memories: LearningMemory[], skillId: string): AssistanceLevel | undefined {
  return memories.find((memory) => memory.skillId === skillId && memory.level !== undefined)?.level;
}

/**
 * Follows the Hode through the runtime's transitions and, when it completes or is ended, stores the
 * compact learning summary. Saving runs in the background: a failure is logged, never shown as a
 * failed Hode.
 */
export class HodeMemoryTracker {
  private steps: StepTrace[] = [];
  private active = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly memory: Pick<MemoryProvider, "storeLearningSummary">) {}

  observe = (event: HodeEvent, prev: HodeState, next: HodeState): void => {
    const done = finishedStep(event, prev, next);
    if (done && this.active) this.steps.push(done);
    const ops = recordFor(event, prev, next, this.active ? TRACKED_HODE : undefined, () => TRACKED_HODE, "");
    for (const op of ops) {
      if (op.op === "start") this.begin();
      if (op.op === "end") this.finish(op.outcome === "completed" ? next : prev, op.outcome);
    }
  };

  /** Resolves once the last summary has been saved (or its failure logged). */
  flushed(): Promise<void> {
    return this.saving;
  }

  private begin(): void {
    this.active = true;
    this.steps = [];
  }

  private finish(final: HodeState, outcome: HodeOutcome): void {
    const summary = summarize(final, this.steps, outcome);
    this.active = false;
    this.steps = [];
    this.saving = this.saving
      .then(() => this.memory.storeLearningSummary(summary))
      .catch((error) => console.error("Saving the learning summary failed", error));
  }
}
