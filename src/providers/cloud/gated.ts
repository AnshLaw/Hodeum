import type { CloudProvider } from "../../data/settings";
import type { ActivityChannel } from "../../lib/activity";
import type { TeachingAction, TeachingContext } from "../../lib/types";
import { ReasonerSkipped, type ReasoningHooks, type ReasoningProvider } from "../interfaces";
import type { CloudPolicy } from "./policy";

export type GatePolicy = Pick<CloudPolicy, "allowed" | "reportSuccess" | "reportFailure">;

/** Lights the cloud privacy dot while context is on its way out. */
export interface CloudActivity {
  track<T>(channel: ActivityChannel, work: () => Promise<T>): Promise<T>;
}

/** A cloud provider didn't run (policy said no, or the request isn't one it may see). Not a failure. */
export class CloudSkipped extends ReasonerSkipped {
  constructor(
    readonly provider: CloudProvider,
    reason: string,
  ) {
    super(`${provider} skipped: ${reason}`);
    this.name = "CloudSkipped";
  }
}

/** Runs a cloud reasoner only when the policy allows it, and tells the policy how it went. */
export class GatedReasoner implements ReasoningProvider {
  readonly id: string;

  constructor(
    private readonly inner: ReasoningProvider,
    private readonly provider: CloudProvider,
    private readonly policy: GatePolicy,
    private readonly activity?: CloudActivity,
  ) {
    this.id = inner.id;
  }

  async reason(context: TeachingContext, hooks?: ReasoningHooks): Promise<TeachingAction> {
    if (!this.policy.allowed(this.provider)) throw new CloudSkipped(this.provider, "not allowed right now");
    try {
      const action = await this.send(context, hooks);
      this.policy.reportSuccess(this.provider);
      return action;
    } catch (error) {
      if (!(error instanceof CloudSkipped)) this.policy.reportFailure(this.provider);
      throw error;
    }
  }

  healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }

  private send(context: TeachingContext, hooks?: ReasoningHooks): Promise<TeachingAction> {
    const work = () => this.inner.reason(context, hooks);
    return this.activity ? this.activity.track("cloud", work) : work();
  }
}
