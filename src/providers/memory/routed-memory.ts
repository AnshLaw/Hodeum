import type { HodeLearningSummary, LearningMemory, MemoryProvider, MemoryQuery } from "../interfaces";

/** A Hode's first step waits on recall; a slow cloud memory gets this long before it's skipped. */
export const CLOUD_RECALL_WAIT_MS = 1500;

function within<T>(work: Promise<T>, ms: number, what: string, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${what} took longer than ${ms} ms`));
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function recallOrNothing(work: Promise<LearningMemory[]>, context: string): Promise<LearningMemory[]> {
  try {
    return await work;
  } catch (error) {
    console.error(context, error);
    return [];
  }
}

/**
 * Local memory always, cloud memory (Backboard, gated by the cloud policy inside its provider) after
 * it. The local write happens first and neither store's failure stops the other or the Hode.
 */
export class RoutedMemory implements MemoryProvider {
  constructor(
    private readonly local: MemoryProvider,
    private readonly cloud?: MemoryProvider,
    /** A hung cloud recall: start its cooldown so later Hodes don't wait on it too. */
    private readonly onCloudTimeout: () => void = () => undefined,
  ) {}

  async storeLearningSummary(summary: HodeLearningSummary): Promise<void> {
    try {
      await this.local.storeLearningSummary(summary);
    } catch (error) {
      console.error("Saving the learning summary locally failed", error);
    }
    if (!this.cloud) return;
    try {
      await this.cloud.storeLearningSummary(summary);
    } catch (error) {
      console.error("Syncing the learning summary to cloud memory failed; it is kept locally", error);
    }
  }

  /** Local memories first: only they carry a level, and the newest local one should drive the nudge. */
  async getRelevantMemory(query: MemoryQuery): Promise<LearningMemory[]> {
    const local = recallOrNothing(this.local.getRelevantMemory(query), "Recalling local learning memory failed");
    const cloud = this.cloud ? recallOrNothing(within(this.cloud.getRelevantMemory(query), CLOUD_RECALL_WAIT_MS, "Cloud memory recall", this.onCloudTimeout), "Recalling cloud memory failed; using local memory") : Promise.resolve([]);
    const [mine, remote] = await Promise.all([local, cloud]);
    return [...mine, ...remote];
  }

  healthCheck(): Promise<boolean> {
    return this.local.healthCheck();
  }
}
