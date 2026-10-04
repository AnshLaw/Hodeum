import type { Dock } from "../features/dock/dock";
import type { WindowOrigin } from "../components/notch/footprint";
import type { MonitorInfo, Rect, WindowRef } from "./types";

/** Native window behaviour the UI needs; `TauriShell` implements it. */
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
