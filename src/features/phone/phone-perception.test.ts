import { afterEach, describe, expect, it, vi } from "vitest";
import { PHONE_OFFLINE_APP, PhonePerception, ocrElements, type OcrSegment, type PhoneEyes } from "./phone-perception";
import { SETTLE_MS } from "./change-detector";

const SIZE = 32 * 64;
const SAMPLE_MS = 250;

function fakeEyes(live = true) {
  const liveHandlers = new Set<() => void>();
  const eyes = {
    live,
    thumb: new Uint8Array(SIZE).fill(220),
    isLive: () => eyes.live,
    grabFrame: async () => ({ png: "PNG", rect: { x: 0, y: 0, width: 590, height: 1280 } }),
    thumbnail: () => eyes.thumb,
    onLive: (h: () => void) => {
      liveHandlers.add(h);
      return () => liveHandlers.delete(h);
    },
    goLive: () => {
      eyes.live = true;
      liveHandlers.forEach((h) => h());
    },
  };
  return eyes;
}

const SEGMENTS: OcrSegment[] = [{ text: "Settings", x: 10, y: 20, width: 80, height: 18 }];

afterEach(() => vi.useRealTimers());

describe("ocrElements", () => {
  it("makes named text elements in frame pixels", () => {
    expect(ocrElements(SEGMENTS)[0]).toMatchObject({ id: "ocr:0", name: "Settings", role: "text", source: "ocr", bounds: { x: 10, y: 20, width: 80, height: 18 } });
  });
});

describe("PhonePerception", () => {
  it("observes OCR text and the screen tone", async () => {
    const eyes = fakeEyes();
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS);
    const o = await p.observe();
    expect(o).toMatchObject({ app: "iPhone", tone: "light" });
    expect(o.elements.map((e) => e.name)).toEqual(["Settings"]);
  });

  it("reports the phone as not connected while nothing is mirroring", async () => {
    const p = new PhonePerception(fakeEyes(false) as PhoneEyes, async () => SEGMENTS);
    expect((await p.observe()).app).toBe(PHONE_OFFLINE_APP);
    expect(await p.focusApp("iPhone")).toBe(false);
  });

  it("fires a learner action when the screen changes and settles, only while watching", async () => {
    vi.useFakeTimers();
    const eyes = fakeEyes();
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS, SAMPLE_MS);
    const seen = vi.fn();
    p.onLearnerAction(seen);
    p.setWatching(true);
    await vi.advanceTimersByTimeAsync(SAMPLE_MS);
    eyes.thumb = new Uint8Array(SIZE).fill(10);
    await vi.advanceTimersByTimeAsync(SETTLE_MS + SAMPLE_MS * 3);
    expect(seen).toHaveBeenCalledTimes(1);
    p.setWatching(false);
    eyes.thumb = new Uint8Array(SIZE).fill(220);
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 4);
    expect(seen).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it("fires a learner action when the mirror goes live while watching", async () => {
    const eyes = fakeEyes(false);
    const p = new PhonePerception(eyes as PhoneEyes, async () => SEGMENTS);
    const seen = vi.fn();
    p.onLearnerAction(seen);
    p.setWatching(true);
    eyes.goLive();
    await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    p.dispose();
  });
});
