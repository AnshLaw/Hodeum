import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhoneSourceStatus } from "./phone-source";

/** A glitch in the iPhone's video stream (a lost frame, the phone rotating) never takes the mirror offline. */

type Channel = { onmessage?: (message: unknown) => void };
const channels: Channel[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (message: unknown) => void;
    constructor() {
      channels.push(this);
    }
  },
}));

class FakeDecoder {
  static made: FakeDecoder[] = [];
  state = "unconfigured";
  decodeQueueSize = 0;
  codec = "";
  constructor(readonly init: { output: (frame: unknown) => void; error: (error: Error) => void }) {
    FakeDecoder.made.push(this);
  }
  configure(config: { codec: string }) {
    this.state = "configured";
    this.codec = config.codec;
  }
  decode() {}
  close() {
    this.state = "closed";
  }
  /** The decoder shows a frame of this size. */
  show(width: number, height: number) {
    this.init.output({ displayWidth: width, displayHeight: height, close: () => undefined });
  }
}

/** A keyframe unit: the key flag, then an Annex-B SPS whose profile byte tells two streams apart. */
const keyframe = (profile: number) => new Uint8Array([1, 0, 0, 0, 1, 0x67, profile, 0, 0x1f, 0, 0, 0, 1, 0x65, 9]).buffer;
const SINK = { draw: () => undefined };

async function streaming() {
  const { AirPlayPhoneSource } = await import("./airplay-source");
  const statuses: PhoneSourceStatus[] = [];
  const source = new AirPlayPhoneSource(async () => undefined as never, () => "auto" as never);
  source.onStatus((status) => statuses.push(status));
  await source.start(SINK as never);
  const channel = channels.at(-1);
  if (!channel?.onmessage) throw new Error("No frame channel");
  return { statuses, send: channel.onmessage };
}

beforeEach(() => {
  FakeDecoder.made = [];
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal("EncodedVideoChunk", class {});
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the AirPlay mirror", () => {
  it("stays live through a decode error, and starts again at the next keyframe", async () => {
    const { statuses, send } = await streaming();
    send(keyframe(0x64));
    FakeDecoder.made[0].show(1170, 2532);
    FakeDecoder.made[0].init.error(new Error("corrupt frame"));
    send(keyframe(0x64));
    FakeDecoder.made[1].show(1170, 2532);
    expect(statuses.map((s) => s.state)).toEqual(["live"]);
  });

  it("reconfigures for a rotated phone's new stream, and passes on its new size", async () => {
    const { statuses, send } = await streaming();
    send(keyframe(0x64));
    FakeDecoder.made[0].show(1170, 2532);
    send(keyframe(0x4d));
    expect(FakeDecoder.made[0].state).toBe("closed");
    expect(FakeDecoder.made[1].codec).toBe("avc1.4d001f");
    FakeDecoder.made[1].show(2532, 1170);
    expect(statuses).toEqual([
      { state: "live", width: 1170, height: 2532 },
      { state: "live", width: 2532, height: 1170 },
    ]);
  });

  it("comes back live after the receiver restarts and the iPhone mirrors again", async () => {
    const { statuses, send } = await streaming();
    send(keyframe(0x64));
    FakeDecoder.made[0].show(1170, 2532);
    send({ state: "waiting" });
    send(keyframe(0x64));
    FakeDecoder.made[1].show(1170, 2532);
    expect(statuses.map((s) => s.state)).toEqual(["live", "waiting", "live"]);
  });

  it("reports an error once decoding keeps failing with nothing shown", async () => {
    const { statuses, send } = await streaming();
    for (let i = 0; i < 3; i++) {
      send(keyframe(0x64));
      FakeDecoder.made.at(-1)?.init.error(new Error("unsupported"));
    }
    expect(statuses.at(-1)?.state).toBe("error");
  });
});
