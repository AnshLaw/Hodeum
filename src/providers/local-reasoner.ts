import type { TeachingAction, TeachingContext } from "../lib/types";
import type { ReasoningProvider } from "./interfaces";

/**
 * Cheapest reliable signal first (PRD §10): the deterministic task-pack planner answers whenever it
 * can ground the step through UI Automation. The local vision model is consulted only when that
 * fails (target not found), for Point & Ask questions, or when there's no planned step at all.
 * Any vision failure falls back to the planner's answer, so a Hode never stops because of the model.
 */
export class LocalReasoningProvider implements ReasoningProvider {
  readonly id = "local";

  constructor(
    private readonly planner: ReasoningProvider,
    private readonly vision: ReasoningProvider,
    private readonly visionReady: () => boolean,
  ) {}

  async reason(context: TeachingContext): Promise<TeachingAction> {
    let planned: TeachingAction | undefined;
    let plannerError: unknown;
    try {
      planned = await this.planner.reason(context);
    } catch (error) {
      plannerError = error;
    }
    if (planned && !needsVision(planned)) return planned;
    if (!this.visionReady()) return orThrow(planned, plannerError);
    try {
      return await this.vision.reason(context);
    } catch (error) {
      console.error("Local vision model failed; using the task-pack answer", error);
      return orThrow(planned, plannerError ?? error);
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.planner.healthCheck();
  }
}

/** The planner couldn't ground the step, or the learner asked about something on screen. */
function needsVision(action: TeachingAction): boolean {
  return action.kind === "clarify" || action.kind === "answer";
}

function orThrow(planned: TeachingAction | undefined, error: unknown): TeachingAction {
  if (planned) return planned;
  throw error instanceof Error ? error : new Error(String(error));
}
