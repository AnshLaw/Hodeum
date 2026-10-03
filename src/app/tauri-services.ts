import { invoke } from "@tauri-apps/api/core";
import { trackRemote } from "../lib/activity";
import type { Bus } from "../lib/bus";
import type { CapturedFrame } from "../providers/vision/types";
import type { WindowInfo, WindowSource } from "./services";

/** Open app windows via Rust. Captures stay in memory and light the notch's screen dot. */
export class TauriWindowSource implements WindowSource {
  constructor(private readonly bus: Bus) {}

  list(): Promise<WindowInfo[]> {
    return invoke<WindowInfo[]>("list_windows");
  }

  async lastActive(): Promise<WindowInfo | undefined> {
    return (await invoke<WindowInfo | null>("last_app_window")) ?? undefined;
  }

  capture(id: string): Promise<CapturedFrame> {
    return trackRemote(this.bus, "screen", () => invoke<CapturedFrame>("capture_window", { id }));
  }
}
