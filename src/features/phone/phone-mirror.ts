import type { Rect } from "../../lib/types";
import type { CapturedFrame } from "../../providers/vision/types";
import type { FrameSurface, PhoneSource, PhoneSourceKind, PhoneSourceStatus } from "./phone-source";

const OFF: PhoneSourceStatus = { state: "off" };

/** The one live iPhone mirror: which source feeds it, its status, and its latest frame. Lives outside React. */
export class PhoneMirror {
  private source: PhoneSource | undefined;
  private stopListening: (() => void) | undefined;
  private current: PhoneSourceStatus = OFF;
  private readonly listeners = new Set<() => void>();
  /** Bumped by every open and close, so a slower, older request never overrides a newer one. */
  private generation = 0;
  private readonly liveHandlers = new Set<() => void>();
  private readonly offlineHandlers = new Set<() => void>();

  /**
   * `toFrame` places a phone-surface highlight in frame pixels. Phone perception already reports frame
   * pixels; the practice stage's phone lives on the page, so it maps page coordinates onto its mirror.
   */
  constructor(
    readonly surface: FrameSurface,
    private readonly create: (kind: PhoneSourceKind) => PhoneSource,
    readonly toFrame: (bounds: Rect) => Rect = (bounds) => bounds,
  ) {}

  isOpen = (): boolean => this.source !== undefined;
  kind = (): PhoneSourceKind | undefined => this.source?.kind;
  status = (): PhoneSourceStatus => this.current;
  isLive = (): boolean => this.current.state === "live";

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onLive(handler: () => void): () => void {
    this.liveHandlers.add(handler);
    return () => {
      this.liveHandlers.delete(handler);
    };
  }

  /** The mirror stopped being live: unplugged, stopped, failed, or closed. */
  onOffline(handler: () => void): () => void {
    this.offlineHandlers.add(handler);
    return () => {
      this.offlineHandlers.delete(handler);
    };
  }

  async open(kind: PhoneSourceKind): Promise<void> {
    if (this.source?.kind === kind && this.current.state !== "error") return;
    const ticket = ++this.generation;
    await this.release();
    if (ticket !== this.generation) return;
    const source = this.create(kind);
    this.source = source;
    this.stopListening = source.onStatus((status) => this.setStatus(status));
    this.setStatus({ state: "connecting" });
    try {
      await source.start(this.surface);
    } catch (error) {
      console.error(`Couldn't start the iPhone ${kind} source`, error);
      if (this.source === source) this.setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    // Closed or switched while it was starting (e.g. the camera prompt was slow): don't leave it running.
    if (this.source !== source) await source.stop().catch((error) => console.error("Stopping a replaced iPhone source failed", error));
  }

  async close(): Promise<void> {
    this.generation++;
    await this.release();
  }

  private async release(): Promise<void> {
    const source = this.source;
    this.stopListening?.();
    this.source = undefined;
    this.stopListening = undefined;
    this.setStatus(OFF);
    if (source) await source.stop().catch((error) => console.error("Stopping the iPhone source failed", error));
  }

  async retry(): Promise<void> {
    const kind = this.kind();
    if (!kind) return;
    await this.close();
    await this.open(kind);
  }

  async grabFrame(): Promise<CapturedFrame> {
    if (!this.isLive()) throw new Error("The iPhone isn't mirroring right now.");
    return this.surface.grab();
  }

  thumbnail(): Uint8Array | undefined {
    return this.isLive() ? this.surface.thumbnail() : undefined;
  }

  private setStatus(status: PhoneSourceStatus): void {
    const wasLive = this.isLive();
    this.current = status;
    this.listeners.forEach((listener) => listener());
    if (!wasLive && this.isLive()) this.liveHandlers.forEach((handler) => handler());
    if (wasLive && !this.isLive()) this.offlineHandlers.forEach((handler) => handler());
  }
}
