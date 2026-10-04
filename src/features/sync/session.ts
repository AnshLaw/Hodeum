import type { SyncSession } from "../account/service";
import type { SyncStatus } from "../account/types";
import { presenceProblem } from "./device-link";

/** The sync engine as the session sees it. */
export interface SyncRunner {
  start(): void;
  stop(): void;
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  syncNow(): Promise<void>;
}

/** This PC's presence on the web dashboard (DeviceLink). */
export interface PresenceLink {
  start(): Promise<void>;
  stop(): void;
  refresh(): Promise<void>;
}

/**
 * One status for Settings: a sync failure comes first; otherwise a PC the dashboard can't see is
 * an error too, so "No PC yet" on the web is never silent on the PC.
 */
export function combineStatus(sync: SyncStatus, presenceProblem: string | undefined): SyncStatus {
  if (!presenceProblem || sync.state !== "idle") return sync;
  return { ...sync, state: "error", error: presenceProblem };
}

/** Sync plus the web dashboard link for one signed-in learner. */
export class AccountSyncSession implements SyncSession {
  private problem: string | undefined;
  private readonly link: PresenceLink;
  private readonly listeners = new Set<(status: SyncStatus) => void>();

  constructor(
    private readonly engine: SyncRunner,
    createLink: (onPresence: (problem?: string) => void) => PresenceLink,
  ) {
    this.link = createLink((problem) => this.setPresence(problem));
    engine.subscribe(() => this.broadcast());
  }

  start(): void {
    this.engine.start();
    this.link.start().catch((error: unknown) => {
      console.error("The web dashboard link didn't start", error);
      this.setPresence(presenceProblem(error));
    });
  }

  stop(): void {
    this.engine.stop();
    this.link.stop();
  }

  status(): SyncStatus {
    return combineStatus(this.engine.status(), this.problem);
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async retry(): Promise<void> {
    await Promise.all([this.engine.syncNow(), this.link.refresh()]);
  }

  private setPresence(problem: string | undefined): void {
    if (problem === this.problem) return;
    this.problem = problem;
    this.broadcast();
  }

  private broadcast(): void {
    const status = this.status();
    for (const listener of [...this.listeners]) listener(status);
  }
}
