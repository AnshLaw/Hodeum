import type { MonitorInfo, Rect } from "./types";

/** Native window behaviour the UI needs. Tauri implements it; the browser stage uses no-ops. */
export interface NativeShell {
  /** The notch pill's box in CSS px; everywhere else in the notch window clicks pass through. */
  setNotchHitRect(rect: Rect): Promise<void>;
  /** Lets the notch take keyboard focus (only while a text field is in use). */
  setNotchActivatable(activatable: boolean): Promise<void>;
  /** Overlay captures the pointer and keyboard for Point & Ask. */
  setOverlayInteractive(interactive: boolean): Promise<void>;
  overlayMonitor(): Promise<MonitorInfo>;
  onNotchHover(handler: (inside: boolean) => void): () => void;
}

export const PAGE_MONITOR: MonitorInfo = { x: 0, y: 0, width: 0, height: 0, scale: 1 };

/** Browser practice stage: everything lives in one page, so there is no native window to manage. */
export class BrowserShell implements NativeShell {
  async setNotchHitRect(): Promise<void> {}
  async setNotchActivatable(): Promise<void> {}
  async setOverlayInteractive(): Promise<void> {}

  async overlayMonitor(): Promise<MonitorInfo> {
    return PAGE_MONITOR;
  }

  onNotchHover(): () => void {
    return () => undefined;
  }
}
