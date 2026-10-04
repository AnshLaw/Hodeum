import type { Rect, Size } from "../lib/types";
import type { FrameSink, PhoneSource, PhoneSourceKind, PhoneSourceStatus } from "../features/phone/phone-source";
import { PHONE_FRAME, type IphoneScene } from "./scenes/iphone";

/** The practice phone mirrored at 2×: sharp in the enlarged notch and under MAX_PHONE_SIDE, so never rescaled. */
const MIRROR_SCALE = 2;
export const STAGE_MIRROR_SIZE: Size = { width: PHONE_FRAME.width * MIRROR_SCALE, height: PHONE_FRAME.height * MIRROR_SCALE };
/** Often enough to follow clicks on the page phone; a real mirror runs at the phone's frame rate. */
const REDRAW_MS = 200;
const TONE = { light: { screen: "#f2f2f7", text: "#000" }, dark: { screen: "#000", text: "#fff" } } as const;
const FONT_PX = 13;
const STATUS = { x: 18, y: 18, text: "9:41" };
const HOME_BAR = { width: 110, height: 4, bottom: 10 };

/** A highlight on the page phone, in the mirrored frame's pixels. */
export function stageFrameRect(bounds: Rect): Rect {
  return {
    x: (bounds.x - PHONE_FRAME.x) * MIRROR_SCALE,
    y: (bounds.y - PHONE_FRAME.y) * MIRROR_SCALE,
    width: bounds.width * MIRROR_SCALE,
    height: bounds.height * MIRROR_SCALE,
  };
}

function paint(ctx: CanvasRenderingContext2D, scene: IphoneScene): void {
  const { elements, tone } = scene.snapshot();
  const colours = TONE[tone ?? "light"];
  ctx.setTransform(MIRROR_SCALE, 0, 0, MIRROR_SCALE, 0, 0);
  ctx.fillStyle = colours.screen;
  ctx.fillRect(0, 0, PHONE_FRAME.width, PHONE_FRAME.height);
  ctx.fillStyle = colours.text;
  ctx.font = `${FONT_PX}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(STATUS.text, STATUS.x, STATUS.y);
  for (const element of elements) {
    const box = { x: element.bounds.x - PHONE_FRAME.x, y: element.bounds.y - PHONE_FRAME.y };
    ctx.fillText(element.name, box.x, box.y + element.bounds.height / 2, element.bounds.width);
  }
  // The home indicator marks the bottom edge, so a cropped mirror is easy to spot.
  ctx.fillRect((PHONE_FRAME.width - HOME_BAR.width) / 2, PHONE_FRAME.height - HOME_BAR.bottom, HOME_BAR.width, HOME_BAR.height);
}

/** Practice stage only: mirrors the page's practice iPhone into the notch, like a real cable or AirPlay source. */
export class StagePhoneSource implements PhoneSource {
  /** Always reports AirPlay, whichever was picked, so the notch never asks the browser for a camera here. */
  readonly kind: PhoneSourceKind = "airplay";
  private readonly handlers = new Set<(status: PhoneSourceStatus) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly scene: IphoneScene) {}

  async start(sink: FrameSink): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.width = STAGE_MIRROR_SIZE.width;
    canvas.height = STAGE_MIRROR_SIZE.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw the practice iPhone mirror (no 2D canvas).");
    const frame = () => {
      paint(ctx, this.scene);
      sink.draw(canvas, canvas.width, canvas.height);
    };
    frame();
    this.emit({ state: "live", ...STAGE_MIRROR_SIZE });
    this.timer = setInterval(frame, REDRAW_MS);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  onStatus(handler: (status: PhoneSourceStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private emit(status: PhoneSourceStatus): void {
    this.handlers.forEach((handler) => handler(status));
  }
}
