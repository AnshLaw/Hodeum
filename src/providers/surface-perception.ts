import type { Rect, ScreenObservation, Surface } from "../lib/types";
import type { PerceptionAdapter } from "./interfaces";

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
