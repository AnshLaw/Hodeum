import { describe, expect, it, vi } from "vitest";
import type { ScreenObservation } from "../lib/types";
import { HOME_SELECTED, INSERT_SELECTED } from "../features/hode/test-fixtures";
import { APP_SWITCH_SETTLE_MS, LEARNER_ACTION_EVENT, LEARNER_WINDOW_EVENT, NativePerception, type NativeBridge } from "./native-perception";

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function fakeBridge(observations: ScreenObservation[]) {
  const listeners = new Map<string, (payload?: unknown) => void>();
  const invoke = vi.fn(async () => {
    const next = observations.shift();
    if (!next) throw new Error("no more observations");
    return next;
  });
  const bridge = {
    invoke,
    listen: (event: string, handler: (payload?: unknown) => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
  } as unknown as NativeBridge;
  return {
    bridge,
    invoke,
    fire: (payload?: unknown) => listeners.get(LEARNER_ACTION_EVENT)?.(payload),
    moveTo: (payload: unknown) => listeners.get(LEARNER_WINDOW_EVENT)?.(payload),
  };
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

  it("passes on what the learner did (clicks, undo, back), including input that arrived mid-read", async () => {
    const { bridge, fire } = fakeBridge([HOME_SELECTED, INSERT_SELECTED]);
    const perception = new NativePerception(bridge);
    const handler = vi.fn();
    perception.onLearnerAction(handler);
    perception.setWatching(true);
    const click = { kind: "click", at: { x: 5, y: 6 }, button: "right" };
    fire([click]);
    fire([{ kind: "undo" }]);
    fire([{ kind: "back" }]);
    await settle();
    expect(handler.mock.calls.map(([o]) => o)).toEqual([
      { ...HOME_SELECTED, inputs: [click] },
      { ...INSERT_SELECTED, inputs: [{ kind: "undo" }, { kind: "back" }] },
    ]);
  });

  it("logs malformed input reports and still reads the screen", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bridge, fire } = fakeBridge([HOME_SELECTED]);
    const perception = new NativePerception(bridge);
    const handler = vi.fn();
    perception.onLearnerAction(handler);
    perception.setWatching(true);
    fire([{ kind: "teleport" }, { kind: "click", at: "nowhere" }]);
    await settle();
    expect(handler).toHaveBeenCalledWith(HOME_SELECTED);
    expect(errorLog).toHaveBeenCalledWith("Ignored a malformed learner input report", expect.anything());
    errorLog.mockRestore();
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

describe("NativePerception.perform", () => {
  it("asks Windows to click the element from a specific screen read, by id and name", async () => {
    const { bridge, invoke } = fakeBridge([HOME_SELECTED]);
    const perception = new NativePerception(bridge);
    const target = { elementId: "uia:7", bounds: { x: 1, y: 2, width: 3, height: 4 }, confidence: 0.95, label: "Insert" };
    await perception.perform({ target, button: "right", name: "Insert", observedAt: 42 });
    expect(invoke).toHaveBeenLastCalledWith("perform_click", { elementId: "uia:7", name: "Insert", observedAt: 42, button: "right" });
  });
});

describe("NativePerception.onAppSwitched", () => {
  const frame = { x: 0, y: 0, width: 800, height: 600 };

  it("reports the app once the learner settles on a different window, not each Alt-Tab stop or move", () => {
    vi.useFakeTimers();
    const { bridge, moveTo } = fakeBridge([]);
    const handler = vi.fn();
    new NativePerception(bridge).onAppSwitched(handler);
    moveTo({ id: 1, bounds: frame, app: "Notepad", appId: "notepad" });
    moveTo({ id: 2, bounds: frame, app: "Calculator", appId: "calculator" });
    moveTo({ id: 3, bounds: frame, app: "Excel", appId: "excel" });
    moveTo({ id: 3, bounds: { ...frame, width: 900 }, app: "Excel", appId: "excel" });
    vi.advanceTimersByTime(APP_SWITCH_SETTLE_MS);
    expect(handler.mock.calls).toEqual([[{ app: "Excel", appId: "excel" }]]);
    vi.useRealTimers();
  });

  it("still reports a switch from an older native side that sends no app", () => {
    vi.useFakeTimers();
    const { bridge, moveTo } = fakeBridge([]);
    const handler = vi.fn();
    new NativePerception(bridge).onAppSwitched(handler);
    moveTo({ id: 7, bounds: frame });
    vi.advanceTimersByTime(APP_SWITCH_SETTLE_MS);
    expect(handler).toHaveBeenCalledWith({});
    vi.useRealTimers();
  });

  it("stops reporting once unsubscribed, even mid-settle", () => {
    vi.useFakeTimers();
    const { bridge, moveTo } = fakeBridge([]);
    const handler = vi.fn();
    const off = new NativePerception(bridge).onAppSwitched(handler);
    moveTo({ id: 1, bounds: frame, app: "Excel" });
    off();
    vi.advanceTimersByTime(APP_SWITCH_SETTLE_MS);
    expect(handler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("NativePerception.openInstalledApp", () => {
  it("opens an app by its catalog id and says whether its window appeared", async () => {
    const invoke = vi.fn(async () => ({ id: "1", title: "Excel", app: "Excel" }));
    const perception = new NativePerception({ invoke, listen: () => () => undefined } as unknown as NativeBridge);
    await expect(perception.openInstalledApp("Microsoft.Office.EXCEL.EXE.15")).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("open_installed_app", { id: "Microsoft.Office.EXCEL.EXE.15" });
    invoke.mockResolvedValueOnce(null as never);
    await expect(perception.openInstalledApp("Brave")).resolves.toBe(false);
  });
});
