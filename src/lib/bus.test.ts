import { describe, expect, it, vi } from "vitest";
import { LocalBus } from "./bus";

describe("LocalBus", () => {
  it("delivers payloads only to subscribers of that event", () => {
    const bus = new LocalBus();
    const onClear = vi.fn();
    const onStart = vi.fn();
    bus.on("overlay:clear", onClear);
    bus.on("annotate:start", onStart);
    bus.emit("overlay:clear", {});
    expect(onClear).toHaveBeenCalledWith({});
    expect(onStart).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new LocalBus();
    const handler = vi.fn();
    const off = bus.on("overlay:clear", handler);
    off();
    bus.emit("overlay:clear", {});
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a handler unsubscribe during emit without skipping others", () => {
    const bus = new LocalBus();
    const second = vi.fn();
    const off = bus.on("overlay:clear", () => off());
    bus.on("overlay:clear", second);
    bus.emit("overlay:clear", {});
    expect(second).toHaveBeenCalledTimes(1);
  });
});
