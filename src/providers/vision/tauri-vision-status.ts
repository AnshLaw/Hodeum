import { invoke } from "@tauri-apps/api/core";
import { reportError } from "../../lib/errors";
import { subscribeTauri } from "../../lib/tauri-bus";
import type { VisionStatus, VisionStatusSource } from "./types";

/** Follows the Rust supervisor of the local llama-server (`vlm_status` + `vlm:status`). */
export class TauriVisionStatus implements VisionStatusSource {
  private status: VisionStatus = { state: "starting" };
  private readonly listeners = new Set<(status: VisionStatus) => void>();

  constructor() {
    invoke<VisionStatus>("vlm_status")
      .then((status) => this.update(status))
      .catch(reportError("Couldn't read the local vision model's status"));
    subscribeTauri<VisionStatus>("vlm:status", (status) => this.update(status));
  }

  current(): VisionStatus {
    return this.status;
  }

  subscribe(listener: (status: VisionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(status: VisionStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
}
