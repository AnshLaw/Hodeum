import { Channel } from "@tauri-apps/api/core";
import { avcCodec, findSps } from "./h264";
import type { AirplayNetwork, FrameSink, PhoneSource, PhoneSourceStatus } from "./phone-source";
import type { AirplayNetworkChoice } from "./prefs";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
/** Mirrors the JSON messages in src-tauri/src/phone/airplay.rs. */
type ReceiverMessage = { state: "waiting" | "streaming" | "failed"; detail?: string | null; network?: AirplayNetwork };

const KEY_FLAG = 1;
const MICROSECONDS = 1000;
/** Past this many queued frames the decoder is behind: skip to the next keyframe to stay live. */
const MAX_DECODE_QUEUE = 6;

/** Raw channel bodies arrive as an ArrayBuffer (small) or via an IPC fetch (large); anything else is a status. */
export function bytesOf(message: unknown): Uint8Array | undefined {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  if (Array.isArray(message)) return Uint8Array.from(message as number[]);
  return undefined;
}

/** The mirror status a receiver message means. Streaming isn't live yet: the decoder says so once a frame shows. */
export function receiverStatus(message: ReceiverMessage): PhoneSourceStatus | undefined {
  if (message.state === "waiting") return { state: "waiting", network: message.network };
  if (message.state === "failed") return { state: "error", message: message.detail ?? "The AirPlay receiver stopped." };
  return undefined;
}

/** AirPlay via the UxPlay receiver: Rust hands over H.264 access units, WebCodecs decodes them here. */
export class AirPlayPhoneSource implements PhoneSource {
  readonly kind = "airplay" as const;
  private readonly handlers = new Set<(status: PhoneSourceStatus) => void>();
  private decoder: VideoDecoder | undefined;
  private live = false;
  private skipToKey = false;

  /** `network` is read at every start, so Try again picks up a changed choice. */
  constructor(
    private readonly invoke: Invoke,
    private readonly network: () => AirplayNetworkChoice,
  ) {}

  onStatus(handler: (status: PhoneSourceStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async start(sink: FrameSink): Promise<void> {
    const channel = new Channel<unknown>();
    channel.onmessage = (message) => {
      const bytes = bytesOf(message);
      if (bytes) this.onUnit(bytes, sink);
      else this.onReceiver(message as ReceiverMessage);
    };
    await this.invoke<void>("airplay_start", { network: this.network(), onFrame: channel });
  }

  async stop(): Promise<void> {
    this.closeDecoder();
    await this.invoke<void>("airplay_stop");
  }

  private onReceiver(message: ReceiverMessage): void {
    const status = receiverStatus(message);
    if (!status) return;
    if (status.state === "error") this.closeDecoder();
    this.emit(status);
  }

  private onUnit(bytes: Uint8Array, sink: FrameSink): void {
    const key = (bytes[0] & KEY_FLAG) !== 0;
    const data = bytes.subarray(1);
    if (!this.decoder && !this.configure(data, key, sink)) return;
    const decoder = this.decoder;
    if (!decoder || decoder.state !== "configured") return;
    if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) this.skipToKey = true;
    if (this.skipToKey && !key) return;
    this.skipToKey = false;
    decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: performance.now() * MICROSECONDS, data }));
  }

  /** The decoder can only start on a keyframe that carries its SPS. */
  private configure(data: Uint8Array, key: boolean, sink: FrameSink): boolean {
    const sps = key ? findSps(data) : undefined;
    if (!sps) return false;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        sink.draw(frame, frame.displayWidth, frame.displayHeight);
        if (!this.live) {
          this.live = true;
          this.emit({ state: "live", width: frame.displayWidth, height: frame.displayHeight });
        }
        frame.close();
      },
      error: (error) => {
        console.error("Decoding the AirPlay video failed", error);
        this.closeDecoder();
        this.emit({ state: "error", message: `Couldn't decode the iPhone video: ${error.message}` });
      },
    });
    this.decoder.configure({ codec: avcCodec(sps), optimizeForLatency: true });
    return true;
  }

  private closeDecoder(): void {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = undefined;
    this.live = false;
  }

  private emit(status: PhoneSourceStatus): void {
    this.handlers.forEach((handler) => handler(status));
  }
}
