import { describe, expect, it, vi } from "vitest";
import { LocalBus } from "../../lib/bus";
import type { InstalledApp } from "../../lib/types";
import { TASK_PACKS } from "../../task-packs";
import catalog from "../apps/__fixtures__/start-apps.json";
import { initialState, type HodeEvent, type HodeState } from "../hode/model";
import { step } from "../hode/reducer";
import type { HodeRuntime } from "../hode/runtime";
import { guideAction } from "../hode/test-fixtures";
import { EVENT_LOG_SIZE, createDebugHook, installDebugHook, type DebugDeps } from "./automation";

const APPS = catalog as InstalledApp[];

/** The runtime's surface the hook uses, over the real reducer with no effects run. */
function fakeRuntime(start: HodeState = initialState) {
  let state = start;
  const listeners = new Set<(event: HodeEvent, prev: HodeState, next: HodeState) => void>();
  const dispatched: HodeEvent[] = [];
  const runtime = {
    getState: () => state,
    dispatch: (event: HodeEvent) => {
      dispatched.push(event);
      const prev = state;
      state = step(prev, event).state;
      listeners.forEach((listener) => listener(event, prev, state));
    },
    onTransition: (listener: (event: HodeEvent, prev: HodeState, next: HodeState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    noticeLanguage: vi.fn(),
    setState: (next: HodeState) => (state = next),
  };
  return { runtime, dispatched };
}

function setup(start?: HodeState) {
  const { runtime, dispatched } = fakeRuntime(start);
  const bus = new LocalBus();
  let clock = 1_000;
  const quit = vi.fn(async () => undefined);
  const deps: DebugDeps = {
    runtime: runtime as unknown as HodeRuntime,
    bus,
    packs: TASK_PACKS,
    apps: () => APPS,
    openGoalsAllowed: () => true,
    quit,
    now: () => clock,
  };
  const hook = createDebugHook(deps);
  return { hook, runtime, dispatched, bus, quit, tick: (ms: number) => (clock += ms) };
}

describe("__hodeumDebug", () => {
  it("starts a Hode like the app does, with the mode and style asked for", () => {
    const { hook, dispatched } = setup();
    hook.api.start("make a pivot table", { mode: "agent", agentStyle: "execute" });
    expect(dispatched.map((e) => e.type)).toEqual(["START_HODE", "GOAL_SUBMITTED"]);
    expect(dispatched[1]).toMatchObject({ mode: "agent", agentStyle: "execute", pack: { id: "excel-pivot" } });
  });

  it("routes said text like a final transcript, so voice commands work without a mic", () => {
    const { hook, dispatched, runtime } = setup();
    expect(hook.api.say("open whatsapp")).toMatchObject([{ type: "OPEN_APP", app: { name: "WhatsApp" } }]);
    expect(runtime.noticeLanguage).toHaveBeenCalledWith("open whatsapp");
    hook.api.say("hello hello hello");
    expect(dispatched.map((e) => e.type)).toEqual(["OPEN_APP"]);
  });

  it("ends the Hode", () => {
    const { hook, dispatched } = setup();
    hook.api.end();
    expect(dispatched).toEqual([{ type: "END_HODE" }]);
  });

  it("snapshots the state an automation needs", () => {
    const action = guideAction();
    const { hook, runtime } = setup();
    runtime.setState({ ...initialState, phase: "guiding", goal: "pivot", action, observation: { app: "Excel", appId: "excel", windowTitle: "Book1", elements: [], at: 0 } });
    expect(hook.api.state()).toMatchObject({
      phase: "guiding",
      goal: "pivot",
      mode: "teach",
      stepIndex: 0,
      level: "demonstrate",
      action: { kind: action.kind, speech: action.speech, target: { label: action.target?.label, bounds: action.target?.bounds } },
      observation: { app: "Excel", appId: "excel", windowTitle: "Book1", elements: 0 },
      lastOverlay: null,
      reasonsPerMinute: 0,
    });
  });

  it("keeps the last transitions, oldest first, up to its size", () => {
    const { hook, runtime } = setup();
    for (let i = 0; i < EVENT_LOG_SIZE + 5; i++) runtime.dispatch({ type: "DISMISS" });
    runtime.dispatch({ type: "START_HODE" });
    expect(hook.api.events(EVENT_LOG_SIZE * 2)).toHaveLength(EVENT_LOG_SIZE);
    expect(hook.api.events(1)).toEqual([{ at: 1_000, type: "START_HODE", from: "idle", to: "goal_entry" }]);
  });

  it("records the last overlay drawn or cleared", () => {
    const { hook, bus } = setup();
    const primitives = [{ kind: "highlight" as const, bounds: { x: 1, y: 2, width: 3, height: 4 }, emphasis: "precise" as const }];
    bus.emit("overlay:render", { primitives, surface: "windows" });
    expect(hook.api.overlay()).toMatchObject({ at: 1_000, primitives, surface: "windows" });
    bus.emit("overlay:clear", {});
    expect(hook.api.overlay()).toMatchObject({ primitives: [] });
  });

  it("counts reasoning requests in the last minute", () => {
    const { hook, tick } = setup();
    // A reasoning request: the request id moves on into the reasoning phase. A pause moves it on too, but isn't one.
    hook.recordTransition({ type: "LOOK_AGAIN" }, { ...initialState, requestId: 1 }, { ...initialState, phase: "reasoning", requestId: 2 });
    hook.recordTransition({ type: "STUCK_TIMEOUT" }, { ...initialState, requestId: 2 }, { ...initialState, phase: "reasoning", requestId: 3 });
    hook.recordTransition({ type: "PAUSE" }, { ...initialState, requestId: 3 }, { ...initialState, phase: "paused", requestId: 4 });
    expect(hook.api.reasonsPerMinute).toBe(2);
    tick(61_000);
    expect(hook.api.reasonsPerMinute).toBe(0);
  });

  it("quits through the native debug command", async () => {
    const { hook, quit } = setup();
    await hook.api.quit();
    expect(quit).toHaveBeenCalled();
  });

  it("installs on the window and removes itself", () => {
    const { runtime } = fakeRuntime();
    const target: { __hodeumDebug?: unknown } = {};
    const deps: DebugDeps = { runtime: runtime as unknown as HodeRuntime, bus: new LocalBus(), packs: TASK_PACKS, apps: () => [], openGoalsAllowed: () => false };
    const remove = installDebugHook(deps, target);
    expect(target.__hodeumDebug).toBeDefined();
    remove();
    expect(target.__hodeumDebug).toBeUndefined();
  });
});
