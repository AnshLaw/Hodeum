import type { Dock } from "../features/dock/dock";
import type { MonitorInfo, Rect } from "./types";

/** Native window behaviour the UI needs. Tauri implements it; the browser stage simulates it in-page. */
export interface NativeShell {
  /** The notch surface's box in CSS px; everywhere else in the notch window clicks pass through. */
  setNotchHitRect(rect: Rect): Promise<void>;
  /** Lets the notch take keyboard focus (only while a text field is in use). */
  setNotchActivatable(activatable: boolean): Promise<void>;
  /** Overlay captures the pointer and keyboard for Point & Ask. */
  setOverlayInteractive(interactive: boolean): Promise<void>;
  overlayMonitor(): Promise<MonitorInfo>;
  onNotchHover(handler: (inside: boolean) => void): () => void;
  /** Moves the notch window to a dock; side docks with `reserve` claim screen space as an app bar. */
  setDock(dock: Dock, reserve: boolean): Promise<void>;
  setNotchVisible(visible: boolean): Promise<void>;
  /** Starts a native drag; the shell reports the dock to snap to via `onDockSnapped`. */
  beginNotchDrag(): Promise<void>;
  onDockSnapped(handler: (dock: Dock) => void): () => void;
  /** Tray menu and Ctrl+Alt+N commands (see `applyCommand`). */
  onShellCommand(handler: (command: string) => void): () => void;
}

export const PAGE_MONITOR: MonitorInfo = { x: 0, y: 0, width: 0, height: 0, scale: 1 };

/** Browser practice stage: everything lives in one page, so window management is a no-op. */
export class BrowserShell implements NativeShell {
  private readonly commandHandlers = new Set<(command: string) => void>();

  async setNotchHitRect(): Promise<void> {}
  async setNotchActivatable(): Promise<void> {}
  async setOverlayInteractive(): Promise<void> {}
  async setDock(): Promise<void> {}
  async setNotchVisible(): Promise<void> {}
  async beginNotchDrag(): Promise<void> {}

  async overlayMonitor(): Promise<MonitorInfo> {
    return PAGE_MONITOR;
  }

  onNotchHover(): () => void {
    return () => undefined;
  }

  onDockSnapped(): () => void {
    return () => undefined;
  }

  onShellCommand(handler: (command: string) => void): () => void {
    this.commandHandlers.add(handler);
    return () => {
      this.commandHandlers.delete(handler);
    };
  }

  /** Lets the stage simulate the tray menu and Ctrl+Alt+N. */
  command(command: string): void {
    this.commandHandlers.forEach((handler) => handler(command));
  }
}
