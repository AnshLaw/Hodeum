import type { FrameSink, PhoneSource, PhoneSourceStatus } from "./phone-source";

export interface CameraInfo {
  deviceId: string;
  label: string;
}

/** Device names that are the mirrored iPhone itself, then ones that are probably a capture card. */
const IPHONE_LIKE = /iphone|mirror/i;
const CAPTURE_LIKE = /capture|hdmi|usb video|cam link|virtual/i;
const IDEAL = { width: 1920, height: 1080, frameRate: 30 };

export function pickCamera(devices: CameraInfo[], preferredLabel?: string): CameraInfo | undefined {
  const named = (pattern: RegExp) => devices.find((d) => pattern.test(d.label));
  // No blind fallback: guessing would mirror the laptop's own webcam as "the iPhone".
  return devices.find((d) => d.label === preferredLabel) ?? named(IPHONE_LIKE) ?? named(CAPTURE_LIKE);
}

/** Device labels stay hidden until the page has used a camera once, so ask briefly first. */
export async function listCameras(): Promise<CameraInfo[]> {
  const probe = await navigator.mediaDevices.getUserMedia({ video: true });
  probe.getTracks().forEach((track) => track.stop());
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

/** iPhoneMirror's virtual camera or a UVC capture card, read in the notch webview. */
export class CameraPhoneSource implements PhoneSource {
  readonly kind = "camera" as const;
  private readonly handlers = new Set<(status: PhoneSourceStatus) => void>();
  private stream: MediaStream | undefined;
  private video: HTMLVideoElement | undefined;
  private running = false;

  constructor(private readonly preferredLabel: () => string | undefined) {}

  onStatus(handler: (status: PhoneSourceStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(sink: FrameSink): Promise<void> {
    const camera = pickCamera(await listCameras(), this.preferredLabel());
    if (!camera) throw new Error("No iPhone video input found. A USB cable needs iPhoneMirror or a capture card running; pick it above. No cable app? Use Wi-Fi (AirPlay).");
    const constraints = { deviceId: { exact: camera.deviceId }, width: { ideal: IDEAL.width }, height: { ideal: IDEAL.height }, frameRate: { ideal: IDEAL.frameRate } };
    this.stream = await navigator.mediaDevices.getUserMedia({ video: constraints });
    this.stream.getVideoTracks()[0]?.addEventListener("ended", () => this.emit({ state: "error", message: `${camera.label} stopped. Is it still plugged in?` }));
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    await video.play();
    this.video = video;
    this.running = true;
    this.pump(video, sink);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video = undefined;
  }

  private pump(video: HTMLVideoElement, sink: FrameSink): void {
    let first = true;
    const next = () => {
      if (!this.running || this.video !== video) return;
      sink.draw(video, video.videoWidth, video.videoHeight);
      if (first) {
        first = false;
        this.emit({ state: "live", width: video.videoWidth, height: video.videoHeight });
      }
      video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  }

  private emit(status: PhoneSourceStatus): void {
    this.handlers.forEach((handler) => handler(status));
  }
}
