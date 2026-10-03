import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowOrigin } from "../components/notch/footprint";
import type { Dock } from "../features/dock/dock";
import type { NativeShell } from "./shell";
import { subscribeTauri } from "./tauri-bus";
import type { MonitorInfo, Rect } from "./types";

export class TauriShell implements NativeShell {
  setNotchHitRect(rect: Rect): Promise<void> {
    return invoke<void>("set_notch_hit_rect", { rect });
  }

  setNotchActivatable(activatable: boolean): Promise<void> {
    return invoke<void>("set_notch_activatable", { activatable });
  }

  setOverlayInteractive(interactive: boolean): Promise<void> {
    return invoke<void>("set_overlay_interactive", { interactive });
  }

  overlayMonitor(): Promise<MonitorInfo> {
    return invoke<MonitorInfo>("monitor_info");
  }

  async notchOrigin(): Promise<WindowOrigin> {
    const window = getCurrentWindow();
    const [position, scale] = await Promise.all([window.outerPosition(), window.scaleFactor()]);
    return { x: position.x, y: position.y, scale };
  }

  onOverlayMoved(handler: () => void): () => void {
    return subscribeTauri<null>("overlay:moved", () => handler());
  }

  onNotchHover(handler: (inside: boolean) => void): () => void {
    return subscribeTauri<boolean>("notch:hover", handler);
  }

  setDock(dock: Dock, reserve: boolean): Promise<void> {
    return invoke<void>("set_dock", { dock, reserve });
  }

  setNotchVisible(visible: boolean): Promise<void> {
    return invoke<void>("set_notch_visible", { visible });
  }

  openApp(from: Rect): Promise<void> {
    return invoke<void>("open_app_window", { from });
  }

  beginNotchDrag(): Promise<void> {
    return invoke<void>("begin_notch_drag");
  }

  onDockSnapped(handler: (dock: Dock) => void): () => void {
    return subscribeTauri<{ dock: Dock }>("dock:snapped", ({ dock }) => handler(dock));
  }

  onShellCommand(handler: (command: string) => void): () => void {
    return subscribeTauri<{ command: string }>("shell:command", ({ command }) => handler(command));
  }
}
