import { errorMessage } from "../lib/errors";
import type { TeachingAction, TeachingContext } from "../lib/types";
import { CloudSkipped } from "./cloud/gated";
import type { ReasoningProvider } from "./interfaces";

export interface RoutedAction {
  action: TeachingAction;
  /** Providers that failed before one succeeded, as `id: message`. A skipped cloud provider isn't one. */
  failures: string[];
}

/** Tries providers in order; the local planner is always last, so a cloud outage never ends the Hode. */
export async function reasonWithFallback(providers: ReasoningProvider[], context: TeachingContext): Promise<RoutedAction> {
  const failures: string[] = [];
  for (const provider of providers) {
    try {
      return { action: await provider.reason(context), failures };
    } catch (error) {
      if (error instanceof CloudSkipped) continue;
      const message = `${provider.id}: ${errorMessage(error)}`;
      console.error("Reasoning provider failed", message);
      failures.push(message);
    }
  }
  throw new Error(`All reasoning providers failed — ${failures.join("; ")}`);
}
