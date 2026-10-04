import type { Dock } from "../features/dock/dock";
import type { WindowOrigin } from "../components/notch/footprint";
import type { MonitorInfo, Rect, WindowRef } from "./types";

/** Native window behaviour the UI needs. Tauri implements it; the browser stage simulates it in-page. */
export interface NativeShell {
  /** The notch surface's box in CSS px; everywhere else in the notch window clicks pass through. */
  setNotchHitRect(rect: Rect): Promise<void>;
  /** Lets the notch take keyboard focus (only while a text field is in use). */
  setNotchActivatable(activatable: boolean): Promise<void>;
  /** Overlay captures the pointer and keyboard for Point & Ask. */
  setOverlayInteractive(interactive: boolean): Promise<void>;
  overlayMonitor(): Promise<MonitorInfo>;
  /** Physical screen position and scale of the notch window (its CSS px map onto the screen from here). */
  notchOrigin(): Promise<WindowOrigin>;
  /** Fires when the overlay moves to another monitor (it follows the learner's app). */
  onOverlayMoved(handler: () => void): () => void;
  /** The learner's front window (Hodeum's own windows don't count); null while none is (desktop, minimized). */
  learnerWindow(): Promise<WindowRef | null>;
  /** Fires when the learner's front window changes, moves or resizes. */
  onLearnerWindow(handler: (window: WindowRef | null) => void): () => void;
  onNotchHover(handler: (inside: boolean) => void): () => void;
  /** Fires when the learner presses a mouse button anywhere off the notch surface (to close its menus). */
  onNotchOutsidePress(handler: () => void): () => void;
  /** Moves the notch window to a dock; side docks with `reserve` claim screen space as an app bar. */
  setDock(dock: Dock, reserve: boolean): Promise<void>;
  setNotchVisible(visible: boolean): Promise<void>;
  /** Grows the top notch window to hold the whole iPhone mirror, or shrinks it back. Side docks ignore it. */
  setNotchTall(tall: boolean): Promise<void>;
  /** Starts a native drag; the shell reports the dock to snap to via `onDockSnapped`. */
  beginNotchDrag(): Promise<void>;
  onDockSnapped(handler: (dock: Dock) => void): () => void;
  /** Opens the Hodeum desktop app, unfolding from `from` (the notch's screen rect, CSS px of the notch window). */
  openApp(from: Rect): Promise<void>;
  /** Tray menu and Hodey key commands (see `applyCommand`). */
  onShellCommand(handler: (command: string) => void): () => void;
}

export const PAGE_MONITOR: MonitorInfo = { x: 0, y: 0, width: 0, height: 0, scale: 1 };

/** Browser practice stage: everything lives in one page, so window management is a no-op. */
export class BrowserShell implements NativeShell {
  private readonly commandHandlers = new Set<(command: string) => void>();
  private readonly openAppHandlers = new Set<(from: Rect) => void>();

  async setNotchHitRect(): Promise<void> {}
  async setNotchActivatable(): Promise<void> {}
  async setOverlayInteractive(): Promise<void> {}
  async setDock(): Promise<void> {}
  async setNotchVisible(): Promise<void> {}
  /** The stage's notch layer already spans the desktop. */
  async setNotchTall(): Promise<void> {}
  async beginNotchDrag(): Promise<void> {}

  /** The stage shows the app in-page; it listens via `onOpenApp`. */
  async openApp(from: Rect): Promise<void> {
    this.openAppHandlers.forEach((handler) => handler(from));
  }

  onOpenApp(handler: (from: Rect) => void): () => void {
    this.openAppHandlers.add(handler);
    return () => {
      this.openAppHandlers.delete(handler);
    };
  }

  async overlayMonitor(): Promise<MonitorInfo> {
    return PAGE_MONITOR;
  }

  /** In the stage the notch layer and the overlay share the desktop's origin. */
  async notchOrigin(): Promise<WindowOrigin> {
    return { x: 0, y: 0, scale: 1 };
  }

  onNotchHover(): () => void {
    return () => undefined;
  }

  /** The stage's notch is a page element: a DOM listener sees presses outside it. */
  onNotchOutsidePress(): () => void {
    return () => undefined;
  }

  onOverlayMoved(): () => void {
    return () => undefined;
  }

  /** The stage's mock apps have no windows: its guidance is never anchored, so this never matters. */
  async learnerWindow(): Promise<WindowRef | null> {
    return null;
  }

  onLearnerWindow(): () => void {
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

  /** Lets the stage simulate the tray menu and the Hodey key. */
  command(command: string): void {
    this.commandHandlers.forEach((handler) => handler(command));
  }
}
