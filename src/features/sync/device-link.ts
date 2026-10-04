import type { Bus, HodeSummary } from "../../lib/bus";
import { isLiveHode } from "../../app/view";
import type { CommandCloud, CommandStatus, PcCommand } from "./types";

/** Older commands are ignored: the learner has likely moved on, or the PC was asleep. */
export const COMMAND_TTL_MS = 2 * 60_000;
/** Matches the `pc_commands.goal` check in Postgres. */
export const MAX_GOAL_LENGTH = 200;
/** The dashboard treats a PC as online when it was seen in the last 75 s. */
export const HEARTBEAT_MS = 30_000;
/** Live Hode updates are coalesced so a fast run of steps sends one row. */
const LIVE_THROTTLE_MS = 1_500;

export interface DeviceIdentity {
  id: string;
  name: string;
}

export type Verdict = { status: Exclude<CommandStatus, "pending">; detail: string; goal?: string };

/** Decides what a web command may do on this PC. Pure. */
export function judgeCommand(command: PcCommand, deviceId: string, now: number): Verdict {
  if (command.device_id !== deviceId) return { status: "rejected", detail: "This command was for another PC." };
  if (now - Date.parse(command.created_at) > COMMAND_TTL_MS) return { status: "expired", detail: "The PC got this too late, so it didn't start." };
  if (command.kind === "end_hode") return { status: "ended", detail: "Hodey ended the Hode on this PC." };
  const goal = command.goal?.trim() ?? "";
  if (goal === "" || goal.length > MAX_GOAL_LENGTH) return { status: "rejected", detail: `A Hode needs a goal of 1–${MAX_GOAL_LENGTH} characters.` };
  return { status: "started", detail: "Hodey started this Hode on the PC.", goal };
}

export interface DeviceLinkDeps {
  cloud: CommandCloud;
  bus: Bus;
  device: DeviceIdentity;
  /** Lights the notch's blue cloud dot while a request is out. */
  track?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Why the dashboard can't see this PC right now, or undefined once it can. */
  onPresence?: (problem?: string) => void;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Starts every presence problem, so Settings can tell it from a sync failure. */
export const PRESENCE_PREFIX = "The web dashboard can't";
export const presenceProblem = (error: unknown): string => `${PRESENCE_PREFIX} see this PC: ${errorText(error)}`;

/** This PC's presence for the web dashboard, and the receiving end of its commands. */
export class DeviceLink {
  private live: HodeSummary | null = null;
  private readonly handled = new Set<string>();
  private stopAll: (() => void) | undefined;
  private liveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: DeviceLinkDeps) {}

  async start(): Promise<void> {
    if (this.stopAll) return;
    const { cloud, bus, device } = this.deps;
    // Also re-checks commands, in case Realtime dropped one while reconnecting.
    const heartbeat = setInterval(() => void this.refresh(), HEARTBEAT_MS);
    const offs = [
      cloud.onCommand(device.id, (command) => void this.handle(command)),
      bus.on("hode:summary", (summary) => this.liveChanged(isLiveHode(summary) ? summary : null)),
    ];
    // A window Windows paused while hidden checks in the moment it's shown again.
    const page = typeof document === "undefined" ? undefined : document;
    const onVisible = () => {
      if (page?.visibilityState === "visible") void this.refresh();
    };
    page?.addEventListener("visibilitychange", onVisible);
    this.stopAll = () => {
      page?.removeEventListener("visibilitychange", onVisible);
      clearInterval(heartbeat);
      clearTimeout(this.liveTimer);
      offs.forEach((off) => off());
    };
    bus.emit("hode:summary-request", {});
    await this.refresh();
  }

  stop(): void {
    this.stopAll?.();
    this.stopAll = undefined;
  }

  /** Tells the dashboard this PC is here and picks up waiting commands now, e.g. from a "Try again". */
  async refresh(): Promise<void> {
    const problem = (await this.beat()) ?? (await this.checkPending());
    this.deps.onPresence?.(problem);
  }

  /** Commands that arrived while this PC was off or Realtime was reconnecting. Returns what went wrong, if anything. */
  async checkPending(): Promise<string | undefined> {
    try {
      const pending = await this.deps.cloud.pendingCommands(this.deps.device.id);
      for (const command of pending) await this.handle(command);
      return undefined;
    } catch (error) {
      console.error("Couldn't check for Hodes started from the web", error);
      return `${PRESENCE_PREFIX} start Hodes on this PC: ${errorText(error)}`;
    }
  }

  private liveChanged(next: HodeSummary | null): void {
    if (JSON.stringify(next) === JSON.stringify(this.live)) return;
    this.live = next;
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => void this.beat().then((problem) => problem && this.deps.onPresence?.(problem)), LIVE_THROTTLE_MS);
  }

  /** Returns why the dashboard couldn't be told, if it couldn't. */
  private async beat(): Promise<string | undefined> {
    const { cloud, device } = this.deps;
    const track = this.deps.track ?? ((work) => work());
    try {
      await track(() => cloud.heartbeat({ id: device.id, name: device.name, last_seen_at: new Date().toISOString(), live: this.live }));
      return undefined;
    } catch (error) {
      console.error("Couldn't tell the web dashboard this PC is online", error);
      return presenceProblem(error);
    }
  }

  /** Claims the command first, so it runs at most once even if Realtime and polling both deliver it. */
  private async handle(command: PcCommand): Promise<void> {
    if (this.handled.has(command.id) || command.status !== "pending") return;
    this.handled.add(command.id);
    const verdict = judgeCommand(command, this.deps.device.id, Date.now());
    try {
      if (!(await this.deps.cloud.settleCommand(command.id, verdict.status, verdict.detail))) return;
    } catch (error) {
      this.handled.delete(command.id);
      console.error(`Couldn't claim web command ${command.id}; will retry`, error);
      return;
    }
    if (verdict.status === "started" && verdict.goal) this.deps.bus.emit("hode:start", { goal: verdict.goal });
    if (verdict.status === "ended") this.deps.bus.emit("hode:end", {});
  }
}
