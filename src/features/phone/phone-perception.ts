import type { Rect, ScreenObservation, UiElement } from "../../lib/types";
import { intersects } from "../../lib/coords";
import type { PerceptionAdapter } from "../../providers/interfaces";
import { ChangeDetector } from "./change-detector";
import { toneOf } from "./frame-math";
import type { PhoneMirror } from "./phone-mirror";

export const PHONE_APP = "iPhone";
/** Never equal to PHONE_APP, so a phone Hode waits ("Connect your iPhone") instead of guiding blind. */
export const PHONE_OFFLINE_APP = "iPhone (not connected)";
/** How often the mirror is sampled for changes while Hodey is watching. */
export const PHONE_SAMPLE_MS = 250;
/** A phone Hode opens the mirror as it starts; give it this long before asking the learner to connect. */
export const PHONE_CONNECT_WAIT_MS = 4000;
/** Windows OCR gives no per-line score; printed UI text reads reliably, so it earns a precise highlight. */
const OCR_CONFIDENCE = 0.9;

/** Mirrors `OcrSegment` in src-tauri/src/phone/ocr.rs. */
export interface OcrSegment {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhoneEyes = Pick<PhoneMirror, "isLive" | "grabFrame" | "thumbnail" | "onLive" | "onOffline">;

export function ocrElements(segments: OcrSegment[]): UiElement[] {
  return segments.map((s, i) => ({
    id: `ocr:${i}`,
    name: s.text,
    role: "text",
    bounds: { x: s.x, y: s.y, width: s.width, height: s.height },
    source: "ocr",
    confidence: OCR_CONFIDENCE,
  }));
}

/** The mirrored iPhone, read by OCR. Learner actions are screen changes that settle. */
export class PhonePerception implements PerceptionAdapter {
  private readonly handlers = new Set<(observation: ScreenObservation) => void>();
  private readonly detector = new ChangeDetector();
  private readonly unsubscribe: Array<() => void>;
  private timer: ReturnType<typeof setInterval> | undefined;
  private watching = false;
  private inFlight = false;
  private rerun = false;

  constructor(
    private readonly eyes: PhoneEyes,
    private readonly ocr: (png: string) => Promise<OcrSegment[]>,
    private readonly sampleMs = PHONE_SAMPLE_MS,
    private readonly connectWaitMs = PHONE_CONNECT_WAIT_MS,
  ) {
    // Connecting or dropping out is a learner action too: the Hode resumes, or asks to reconnect.
    const onChange = () => this.watching && this.emit();
    this.unsubscribe = [eyes.onLive(onChange), eyes.onOffline(onChange)];
  }

  async observe(region?: Rect): Promise<ScreenObservation> {
    if (!this.eyes.isLive()) return { app: PHONE_OFFLINE_APP, windowTitle: "", elements: [], at: Date.now() };
    const frame = await this.eyes.grabFrame();
    const elements = ocrElements(await this.ocr(frame.png));
    const thumb = this.eyes.thumbnail();
    return {
      app: PHONE_APP,
      windowTitle: "",
      elements: region ? elements.filter((e) => intersects(e.bounds, region)) : elements,
      at: Date.now(),
      tone: thumb ? toneOf(thumb) : undefined,
    };
  }

  async focusApp(app: string): Promise<boolean> {
    if (app.toLowerCase() !== PHONE_APP.toLowerCase()) return false;
    if (this.eyes.isLive()) return true;
    return new Promise((resolve) => {
      const done = (live: boolean) => {
        clearTimeout(timer);
        off();
        resolve(live);
      };
      const off = this.eyes.onLive(() => done(true));
      const timer = setTimeout(() => done(false), this.connectWaitMs);
    });
  }

  onLearnerAction(handler: (observation: ScreenObservation) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  setWatching(watching: boolean): void {
    if (watching === this.watching) return;
    this.watching = watching;
    clearInterval(this.timer);
    this.timer = undefined;
    this.detector.reset();
    if (watching) this.timer = setInterval(() => this.sample(), this.sampleMs);
  }

  dispose(): void {
    this.setWatching(false);
    this.unsubscribe.forEach((off) => off());
    this.handlers.clear();
  }

  private sample(): void {
    const thumb = this.eyes.thumbnail();
    if (thumb && this.detector.push(thumb, Date.now())) this.emit();
  }

  private emit(): void {
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    this.inFlight = true;
    this.observe()
      .then(
        (observation) => this.handlers.forEach((handler) => handler(observation)),
        (error) => console.error("Couldn't read the iPhone after the learner's action", error),
      )
      .finally(() => {
        this.inFlight = false;
        if (this.rerun) {
          this.rerun = false;
          this.emit();
        }
      });
  }
}
