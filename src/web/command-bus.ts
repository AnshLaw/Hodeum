import { LocalBus, type Bus, type BusEventName, type BusEvents, type BusHandler, type HodeSummary } from "../lib/bus";
import { HEARTBEAT_MS } from "../features/sync/device-link";
import type { CommandKind, DeviceRow, PcCommand } from "../features/sync/types";

/** How often the dashboard checks whether the PC picked a command up. */
const POLL_MS = 1_500;
/** Covers the PC's fallback check (each heartbeat) when Realtime misses a command; the command itself expires on the PC's side. */
export const ANSWER_TIMEOUT_MS = HEARTBEAT_MS + 15_000;

const IDLE: HodeSummary = { phase: "idle", goal: "", title: "" };

export interface CommandSender {
  /** Inserts a command for the PC; returns its id. */
  send(deviceId: string, kind: CommandKind, goal?: string): Promise<string>;
  status(id: string): Promise<Pick<PcCommand, "status" | "detail">>;
}

export interface CommandFeedback {
  tone: "pending" | "done" | "error";
  text: string;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The desktop pages' bus, on the web: Start/End a Hode become commands for the chosen PC, and its
 * live Hode answers summary requests. Everything else stays in the page.
 */
export class WebBus implements Bus {
  private readonly local = new LocalBus();

  constructor(
    private readonly sender: CommandSender,
    private readonly target: () => DeviceRow | undefined,
    private readonly feedback: (feedback: CommandFeedback) => void,
    /** Why there's no PC right now: still loading, couldn't load, or none linked. */
    private readonly noPc: () => string,
  ) {}

  emit<K extends BusEventName>(name: K, payload: BusEvents[K]): void {
    if (name === "hode:start") void this.command("start_hode", (payload as BusEvents["hode:start"]).goal);
    else if (name === "hode:end") void this.command("end_hode");
    else if (name === "hode:summary-request") this.local.emit("hode:summary", this.target()?.live ?? IDLE);
    else this.local.emit(name, payload);
  }

  on<K extends BusEventName>(name: K, handler: BusHandler<K>): () => void {
    return this.local.on(name, handler);
  }

  private async command(kind: CommandKind, goal?: string): Promise<void> {
    const pc = this.target();
    if (!pc) return this.feedback({ tone: "error", text: this.noPc() });
    const verb = kind === "start_hode" ? "Starting" : "Ending";
    this.feedback({ tone: "pending", text: `${verb} on ${pc.name}…` });
    try {
      const id = await this.sender.send(pc.id, kind, goal);
      for (let waited = 0; waited < ANSWER_TIMEOUT_MS; waited += POLL_MS) {
        await wait(POLL_MS);
        const { status, detail } = await this.sender.status(id);
        if (status === "started") return this.feedback({ tone: "done", text: `Started on ${pc.name}. Hodey is guiding you there.` });
        if (status === "ended") return this.feedback({ tone: "done", text: `Ended the Hode on ${pc.name}.` });
        if (status !== "pending") return this.feedback({ tone: "error", text: `${pc.name} didn't start it: ${detail ?? status}` });
      }
      this.feedback({ tone: "error", text: `${pc.name} didn't answer. Is Hodeum running and signed in there, with sync on?` });
    } catch (error) {
      console.error(`Couldn't send ${kind} to ${pc.name}`, error);
      this.feedback({ tone: "error", text: `Couldn't reach ${pc.name}: ${errorText(error)}` });
    }
  }
}
