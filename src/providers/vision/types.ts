import type { Rect } from "../../lib/types";

/** A downscaled capture of the learner's app. Mirrors `CapturedFrame` in src-tauri/src/perception/mod.rs. */
export interface CapturedFrame {
  /** Base64 PNG, longest side at most 1280 px. */
  png: string;
  /** Where the captured window sits on screen, in physical px. */
  rect: Rect;
}

/** Mirrors `VlmStatus` in src-tauri/src/vlm.rs. */
export type VisionStatus =
  | { state: "missing"; detail: string }
  | { state: "starting" }
  | { state: "ready"; endpoint: string; api_key: string }
  | { state: "failed"; detail: string };

/** Live status of the local vision model, so reasoning can skip it while it's unavailable. */
export interface VisionStatusSource {
  current(): VisionStatus;
  subscribe(listener: (status: VisionStatus) => void): () => void;
}

/** How to reach the running local model; the key is a per-launch secret held only in memory. */
export interface VisionConnection {
  endpoint: string;
  apiKey: string;
}

export function connectionOf(status: VisionStatus): VisionConnection | undefined {
  return status.state === "ready" ? { endpoint: status.endpoint, apiKey: status.api_key } : undefined;
}
