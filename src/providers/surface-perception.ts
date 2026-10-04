import type { AppLaunch, PerformRequest, Rect, ScreenObservation, Surface, UiElement } from "../lib/types";
import type { AppSwitch, PerceptionAdapter } from "./interfaces";

export interface WatchablePerception extends PerceptionAdapter {
  setWatching(watching: boolean): void;
}

const SURFACES: Surface[] = ["windows", "phone"];

/** Sends perception to the Windows desktop or the mirrored iPhone, whichever the running Hode is about. */
export class SurfacePerception implements PerceptionAdapter {
  private active: Surface = "windows";
  private watching = false;

  constructor(private readonly adapters: Record<Surface, WatchablePerception>) {}

  current = (): Surface => this.active;

  setSurface(surface: Surface): void {
    if (surface === this.active) return;
    this.active = surface;
    this.applyWatching();
  }

  setWatching(watching: boolean): void {
    this.watching = watching;
    this.applyWatching();
  }

  observe(region?: Rect): Promise<ScreenObservation> {
    return this.adapters[this.active].observe(region);
  }

  async focusApp(app: string): Promise<boolean> {
    return (await this.adapters[this.active].focusApp?.(app)) ?? false;
  }

  async launchApp(app: string, launch: AppLaunch): Promise<boolean> {
    return (await this.adapters[this.active].launchApp?.(app, launch)) ?? false;
  }

  /** Only the desktop has windows to switch between. */
  onAppSwitched(handler: (window: AppSwitch) => void): () => void {
    return this.adapters.windows.onAppSwitched?.((window) => this.active === "windows" && handler(window)) ?? (() => undefined);
  }

  /** Apps open on the desktop, whichever surface the Hode is on. */
  async openInstalledApp(id: string): Promise<boolean> {
    const open = this.adapters.windows.openInstalledApp;
    if (!open) throw new Error("Opening apps isn't available here.");
    return open.call(this.adapters.windows, id);
  }

  /** The desktop's taskbar; a phone has none. */
  async shellTargets(): Promise<UiElement[]> {
    if (this.active !== "windows") return [];
    return (await this.adapters.windows.shellTargets?.()) ?? [];
  }

  async perform(request: PerformRequest): Promise<void> {
    const adapter = this.adapters[this.active];
    if (!adapter.perform) throw new Error(`Hodey can't click on the ${this.active === "phone" ? "iPhone" : "desktop"} yet.`);
    return adapter.perform(request);
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    const offs = SURFACES.map((surface) =>
      this.adapters[surface].onLearnerAction((observation) => {
        if (surface === this.active) handler(observation);
      }),
    );
    return () => offs.forEach((off) => off());
  }

  private applyWatching(): void {
    SURFACES.forEach((surface) => this.adapters[surface].setWatching(this.watching && surface === this.active));
  }
}
