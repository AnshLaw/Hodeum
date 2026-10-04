import type { Bus, BusEvents } from "../../lib/bus";
import type { AgentStyle, HodeMode, InstalledApp, Rect, TaskPack, TeachingActionKind } from "../../lib/types";
import { startFromApp } from "../hode/bridge";
import { currentStep, type HodeEvent, type HodePhase, type HodeState } from "../hode/model";
import type { HodeRuntime } from "../hode/runtime";
import { routeUtterance } from "../voice/route";

/**
 * DEV builds only: `window.__hodeumDebug`, so an automation (over the WebView's DevTools port) can drive and
 * inspect the real notch without a mic or clicks. Installed from entries/notch.tsx under `import.meta.env.DEV`,
 * so release builds tree-shake it out.
 */

/** Transitions kept for `events()`. */
export const EVENT_LOG_SIZE = 200;
const DEFAULT_EVENTS = 50;
const MINUTE_MS = 60_000;

export interface DebugDeps {
  runtime: HodeRuntime;
  bus: Bus;
  packs: TaskPack[];
  apps: () => InstalledApp[];
  openGoalsAllowed: () => boolean;
  /** Quits the app gracefully (the native `debug_quit`, debug builds only). */
  quit?: () => Promise<void>;
  now?: () => number;
}

export interface DebugEvent {
  at: number;
  type: HodeEvent["type"];
  from: HodePhase;
  to: HodePhase;
}

export interface DebugOverlay {
  at: number;
  primitives: BusEvents["overlay:render"]["primitives"];
  surface?: BusEvents["overlay:render"]["surface"];
  anchor?: BusEvents["overlay:render"]["anchor"];
}

export interface DebugSnapshot {
  phase: HodePhase;
  goal: string;
  mode: HodeMode;
  agentStyle: AgentStyle;
  packId?: string;
  open: boolean;
  stepIndex: number;
  stepObjective?: string;
  level: HodeState["level"];
  mistakes: number;
  wrongActions: number;
  requestId: number;
  waitingForApp?: string;
  action?: { kind: TeachingActionKind; speech: string; target?: { label: string; bounds: Rect } };
  observation?: { app: string; appId?: string; windowTitle: string; elements: number };
  notice?: string;
  correction?: string;
  lastOverlay: DebugOverlay | null;
  reasonsPerMinute: number;
}

export interface HodeumDebug {
  start(goal: string, options?: { mode?: HodeMode; agentStyle?: AgentStyle }): void;
  say(text: string): HodeEvent[];
  end(): void;
  state(): DebugSnapshot;
  events(n?: number): DebugEvent[];
  overlay(): DebugOverlay | null;
  /** Reasoning requests in the last minute: a Hode looping on its own shows up here. */
  readonly reasonsPerMinute: number;
  quit(): Promise<void>;
}

function snapshotOf(s: HodeState, lastOverlay: DebugOverlay | null, reasonsPerMinute: number): DebugSnapshot {
  const target = s.action?.target;
  const observation = s.observation;
  return {
    phase: s.phase,
    goal: s.goal,
    mode: s.mode,
    agentStyle: s.agentStyle,
    packId: s.pack?.id,
    open: s.open,
    stepIndex: s.stepIndex,
    stepObjective: currentStep(s)?.objective,
    level: s.level,
    mistakes: s.mistakes,
    wrongActions: s.wrongActions,
    requestId: s.requestId,
    waitingForApp: s.waitingForApp,
    action: s.action && { kind: s.action.kind, speech: s.action.speech, target: target && { label: target.label, bounds: target.bounds } },
    observation: observation && { app: observation.app, appId: observation.appId, windowTitle: observation.windowTitle, elements: observation.elements.length },
    notice: s.notice,
    correction: s.correction,
    lastOverlay,
    reasonsPerMinute,
  };
}

/** The hook and its recorders; `recordTransition` is exposed for tests. */
export function createDebugHook(deps: DebugDeps) {
  const now = deps.now ?? Date.now;
  const log: DebugEvent[] = [];
  const reasons: number[] = [];
  let lastOverlay: DebugOverlay | null = null;
  const recentReasons = () => reasons.filter((at) => now() - at < MINUTE_MS).length;
  const recordTransition = (event: HodeEvent, prev: HodeState, next: HodeState) => {
    log.push({ at: now(), type: event.type, from: prev.phase, to: next.phase });
    if (log.length > EVENT_LOG_SIZE) log.shift();
    if (next.phase === "reasoning" && next.requestId !== prev.requestId) reasons.push(now());
    while (reasons.length > 0 && now() - reasons[0] >= MINUTE_MS) reasons.shift();
  };
  const offs = [
    deps.runtime.onTransition(recordTransition),
    deps.bus.on("overlay:render", ({ primitives, surface, anchor }) => (lastOverlay = { at: now(), primitives, surface, anchor })),
    deps.bus.on("overlay:clear", () => (lastOverlay = { at: now(), primitives: [] })),
  ];
  const { runtime } = deps;
  const api: HodeumDebug = {
    start: (goal, options = {}) => startFromApp(runtime, goal, deps.packs, deps.openGoalsAllowed(), { apps: deps.apps(), ...options }),
    say: (text) => {
      runtime.noticeLanguage(text);
      const events = routeUtterance(runtime.getState(), text, deps.packs, deps.openGoalsAllowed(), [], deps.apps());
      events.forEach(runtime.dispatch);
      return events;
    },
    end: () => runtime.dispatch({ type: "END_HODE" }),
    state: () => snapshotOf(runtime.getState(), lastOverlay, recentReasons()),
    events: (n = DEFAULT_EVENTS) => log.slice(-n),
    overlay: () => lastOverlay,
    get reasonsPerMinute() {
      return recentReasons();
    },
    quit: () => (deps.quit ? deps.quit() : Promise.reject(new Error("Quitting isn't available here"))),
  };
  return { api, recordTransition, dispose: () => offs.forEach((off) => off()) };
}

/** Assigns `__hodeumDebug` on `target` (the notch's window). Returns a disposer. */
export function installDebugHook(deps: DebugDeps, target: { __hodeumDebug?: unknown } = window as unknown as { __hodeumDebug?: unknown }): () => void {
  const hook = createDebugHook(deps);
  target.__hodeumDebug = hook.api;
  return () => {
    hook.dispose();
    delete target.__hodeumDebug;
  };
}
