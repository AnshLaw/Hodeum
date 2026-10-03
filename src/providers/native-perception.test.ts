import { describe, expect, it, vi } from "vitest";
import type { ScreenObservation } from "../lib/types";
import { HOME_SELECTED, INSERT_SELECTED } from "../features/hode/test-fixtures";
import { LEARNER_ACTION_EVENT, NativePerception, type NativeBridge } from "./native-perception";

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeBridge(observations: ScreenObservation[]) {
  const listeners = new Map<string, () => void>();
  const invoke = vi.fn(async () => {
    const next = observations.shift();
    if (!next) throw new Error("no more observations");
    return next;
  });
  const bridge = {
    invoke,
    listen: (event: string, handler: () => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
  } as unknown as NativeBridge;
  return { bridge, invoke, fire: () => listeners.get(LEARNER_ACTION_EVENT)?.() };
}

describe("NativePerception", () => {
  it("observes through the native command, passing the region", async () => {
    const { bridge, invoke } = fakeBridge([HOME_SELECTED]);
    const region = { x: 1, y: 2, width: 3, height: 4 };
    await expect(new NativePerception(bridge).observe(region)).resolves.toBe(HOME_SELECTED);
    expect(invoke).toHaveBeenCalledWith("observe", { region });
  });

  it("ignores learner input until a Hode is watching", async () => {
    const { bridge, invoke, fire } = fakeBridge([INSERT_SELECTED]);
    const perception = new NativePerception(bridge);
    const handler = vi.fn();
    perception.onLearnerAction(handler);
    fire();
    await settle();
    expect(invoke).not.toHaveBeenCalled();
    perception.setWatching(true);
    fire();
    await settle();
    expect(handler).toHaveBeenCalledWith(INSERT_SELECTED);
  });

  it("coalesces input that arrives while a read is in flight", async () => {
    const { bridge, invoke, fire } = fakeBridge([HOME_SELECTED, INSERT_SELECTED]);
    const perception = new NativePerception(bridge);
    const handler = vi.fn();
    perception.onLearnerAction(handler);
    perception.setWatching(true);
    fire();
    fire();
    fire();
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls.map(([o]) => o)).toEqual([HOME_SELECTED, INSERT_SELECTED]);
  });

  it("logs a failed read instead of throwing", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bridge, fire } = fakeBridge([]);
    const perception = new NativePerception(bridge);
    perception.onLearnerAction(vi.fn());
    perception.setWatching(true);
    fire();
    await settle();
    expect(errorLog).toHaveBeenCalledWith("Couldn't read the screen after the learner's action", expect.any(Error));
    errorLog.mockRestore();
  });
});
