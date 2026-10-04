import type { Size } from "../../lib/types";
import type { CapturedFrame } from "../../providers/vision/types";

export type PhoneSourceKind = "camera" | "airplay";

/** Where the iPhone has to be to see the AirPlay receiver. Mirrors `Network` in src-tauri/src/phone/airplay.rs. */
export type AirplayNetwork =
  | { kind: "usb" }
  | { kind: "hotspot"; ssid: string; passphrase: string }
  /** `problem`: why the direct link (cable or laptop hotspot) couldn't be used, when it was wanted. */
  | { kind: "wifi"; problem: string | null };

export type PhoneSourceStatus =
  | { state: "off" }
  | { state: "connecting" }
  /** The receiver is up; the iPhone hasn't started mirroring yet. `network`: AirPlay only. */
  | { state: "waiting"; network?: AirplayNetwork }
  | { state: "live"; width: number; height: number }
  | { state: "error"; message: string };

/** Where a source draws each decoded frame (full source size; the sink crops to the phone). */
export interface FrameSink {
  draw(image: CanvasImageSource, width: number, height: number): void;
}

/** The latest phone frame: shown in the notch, read by OCR and the vision model, sampled for changes. */
export interface FrameSurface extends FrameSink {
  readonly size: Size | undefined;
  readonly element?: HTMLCanvasElement;
  grab(): CapturedFrame;
  thumbnail(): Uint8Array;
}

/** One way of getting the iPhone's screen onto this PC. */
export interface PhoneSource {
  readonly kind: PhoneSourceKind;
  start(sink: FrameSink): Promise<void>;
  stop(): Promise<void>;
  onStatus(handler: (status: PhoneSourceStatus) => void): () => void;
}
