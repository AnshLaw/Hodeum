import { describe, expect, it } from "vitest";
import { PhoneMirror } from "./phone-mirror";
import type { FrameSink, FrameSurface, PhoneSource, PhoneSourceKind, PhoneSourceStatus } from "./phone-source";

class FakeSource implements PhoneSource {
  readonly handlers = new Set<(s: PhoneSourceStatus) => void>();
  stopped = false;
  constructor(readonly kind: PhoneSourceKind, private readonly failWith?: string) {}
  async start(_sink: FrameSink) {
    if (this.failWith) throw new Error(this.failWith);
    this.emit({ state: "connecting" });
  }
  async stop() {
    this.stopped = true;
  }
  onStatus(handler: (s: PhoneSourceStatus) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(status: PhoneSourceStatus) {
    this.handlers.forEach((h) => h(status));
  }
}

const surface: FrameSurface = { size: { width: 10, height: 20 }, draw() {}, grab: () => ({ png: "AAA", rect: { x: 0, y: 0, width: 10, height: 20 } }), thumbnail: () => new Uint8Array(4) };

describe("PhoneMirror", () => {
  it("opens a source, follows its status and reports live", async () => {
    const sources: FakeSource[] = [];
    const mirror = new PhoneMirror(surface, (kind) => sources[sources.push(new FakeSource(kind)) - 1]);
    let lives = 0;
    mirror.onLive(() => lives++);
    await mirror.open("camera");
    expect(mirror.status()).toEqual({ state: "connecting" });
    sources[0].emit({ state: "live", width: 10, height: 20 });
    expect(mirror.isLive()).toBe(true);
    expect(lives).toBe(1);
    await expect(mirror.grabFrame()).resolves.toMatchObject({ png: "AAA" });
  });

  it("tells listeners when the mirror stops being live", async () => {
    const sources: FakeSource[] = [];
    const mirror = new PhoneMirror(surface, (kind) => sources[sources.push(new FakeSource(kind)) - 1]);
    let offline = 0;
    mirror.onOffline(() => offline++);
    await mirror.open("camera");
    sources[0].emit({ state: "live", width: 10, height: 20 });
    sources[0].emit({ state: "error", message: "unplugged" });
    expect(offline).toBe(1);
    await mirror.close();
    expect(offline).toBe(1);
  });

  it("switching source stops the old one", async () => {
    const sources: FakeSource[] = [];
    const mirror = new PhoneMirror(surface, (kind) => sources[sources.push(new FakeSource(kind)) - 1]);
    await mirror.open("camera");
    await mirror.open("airplay");
    expect(sources[0].stopped).toBe(true);
    expect(mirror.kind()).toBe("airplay");
  });

  it("shows a start failure as an error state instead of throwing", async () => {
    const mirror = new PhoneMirror(surface, (kind) => new FakeSource(kind, "AirPlay receiver not installed"));
    await mirror.open("airplay");
    expect(mirror.status()).toEqual({ state: "error", message: "AirPlay receiver not installed" });
  });

  it("refuses to grab a frame while not live", async () => {
    const mirror = new PhoneMirror(surface, (kind) => new FakeSource(kind));
    await expect(mirror.grabFrame()).rejects.toThrow(/isn't mirroring/);
  });
});
