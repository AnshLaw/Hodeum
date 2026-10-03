import { invoke } from "@tauri-apps/api/core";
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

  onNotchHover(handler: (inside: boolean) => void): () => void {
    return subscribeTauri<boolean>("notch:hover", handler);
  }
}
