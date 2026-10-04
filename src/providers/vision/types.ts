import type { Rect } from "../../lib/types";

/** A downscaled capture of the learner's app. Mirrors `CapturedFrame` in src-tauri/src/perception/mod.rs. */
export interface CapturedFrame {
  /** Base64 image of type `mime` (the name is historical), longest side at most 1280 px. */
  png: string;
  /** "image/jpeg" from the native capture; PNG when absent (the phone mirror, older builds). */
  mime?: string;
  /** Where the captured window sits on screen, in physical px. */
  rect: Rect;
  /** The captured window's id (same as `WindowRef.id`), so a capture of another window than the screen read is caught. */
  windowId?: number;
}

const DEFAULT_FRAME_MIME = "image/png";

/** The frame as a data URL for an OpenAI-style image_url part. */
export function frameDataUrl(frame: CapturedFrame): string {
  return `data:${frame.mime ?? DEFAULT_FRAME_MIME};base64,${frame.png}`;
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
