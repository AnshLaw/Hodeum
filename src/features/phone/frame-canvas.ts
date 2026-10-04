import type { Size } from "../../lib/types";
import type { CapturedFrame } from "../../providers/vision/types";
import { MAX_PHONE_SIDE, THUMB_HEIGHT, THUMB_WIDTH, fitWithin, grayscale, phoneCrop } from "./frame-math";
import type { FrameSurface } from "./phone-source";

const PNG_PREFIX = "data:image/png;base64,";

function context(canvas: HTMLCanvasElement, readBack: boolean): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: readBack });
  if (!ctx) throw new Error("This webview can't draw the iPhone mirror (no 2D canvas).");
  return ctx;
}

/** The latest phone frame, cropped to the phone and capped at MAX_PHONE_SIDE. Shown in the notch and read by OCR. */
export class FrameCanvas implements FrameSurface {
  readonly element = document.createElement("canvas");
  private readonly thumb = document.createElement("canvas");
  private readonly ctx = context(this.element, false);
  private readonly thumbCtx: CanvasRenderingContext2D;
  size: Size | undefined;

  constructor() {
    this.thumb.width = THUMB_WIDTH;
    this.thumb.height = THUMB_HEIGHT;
    this.thumbCtx = context(this.thumb, true);
  }

  draw(image: CanvasImageSource, width: number, height: number): void {
    const crop = phoneCrop(width, height);
    const out = fitWithin(crop.width, crop.height, MAX_PHONE_SIDE);
    if (this.element.width !== out.width || this.element.height !== out.height) {
      this.element.width = out.width;
      this.element.height = out.height;
    }
    this.ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
    this.size = out;
  }

  grab(): CapturedFrame {
    const size = this.size;
    if (!size) throw new Error("No iPhone frame has arrived yet.");
    const png = this.element.toDataURL("image/png").slice(PNG_PREFIX.length);
    return { png, rect: { x: 0, y: 0, width: size.width, height: size.height } };
  }

  thumbnail(): Uint8Array {
    this.thumbCtx.drawImage(this.element, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
    return grayscale(this.thumbCtx.getImageData(0, 0, THUMB_WIDTH, THUMB_HEIGHT).data);
  }
}
