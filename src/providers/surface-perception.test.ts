import { describe, expect, it, vi } from "vitest";
import type { ScreenObservation } from "../lib/types";
import { SurfacePerception, type WatchablePerception } from "./surface-perception";

function fake(app: string) {
  const handlers = new Set<(o: ScreenObservation) => void>();
  const adapter: WatchablePerception & { fire(): void; watching: boolean } = {
    watching: false,
    observe: async () => ({ app, windowTitle: "", elements: [], at: 0 }),
    focusApp: async () => true,
    onLearnerAction: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    setWatching(w) {
      adapter.watching = w;
    },
    fire: () => handlers.forEach((h) => h({ app, windowTitle: "", elements: [], at: 0 })),
  };
  return adapter;
}

describe("SurfacePerception", () => {
  it("observes and watches only through the active surface", async () => {
    const windows = fake("Excel");
    const phone = fake("iPhone");
    const s = new SurfacePerception({ windows, phone });
    const seen = vi.fn();
    s.onLearnerAction(seen);
    s.setWatching(true);
    expect((await s.observe()).app).toBe("Excel");
    expect([windows.watching, phone.watching]).toEqual([true, false]);

    s.setSurface("phone");
    expect((await s.observe()).app).toBe("iPhone");
    expect([windows.watching, phone.watching]).toEqual([false, true]);
    windows.fire();
    phone.fire();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].app).toBe("iPhone");
  });
});
