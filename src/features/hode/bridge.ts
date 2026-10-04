import type { Bus, HodeSummary } from "../../lib/bus";
import type { HodeMode, TaskPack } from "../../lib/types";
import { HodeRecorder } from "../../data/recorder";
import type { Settings, SettingsStore } from "../../data/settings";
import type { HodeLog } from "../../data/types";
import { appFromGoal, matchGoal } from "../../task-packs/match";
import { currentStep, type HodeEvent, type HodeState } from "./model";
import type { HodeRuntime } from "./runtime";

const MS_PER_SECOND = 1000;

export function summaryOf(s: HodeState): HodeSummary {
  const total = s.pack?.steps.length;
  return {
    phase: s.phase,
    goal: s.goal,
    title: s.action?.speech || currentStep(s)?.objective || "",
    step: total ? { current: s.stepIndex + 1, total } : undefined,
  };
}

export interface BridgeDeps {
  runtime: HodeRuntime;
  bus: Bus;
  log: HodeLog;
  settings: SettingsStore;
  packs: TaskPack[];
  /** Whether the local vision model can plan goals that have no task pack. */
  openGoalsAllowed: () => boolean;
  /** Applies speech settings to the voice in use. */
  applyVoice: (voice: Settings["voice"]) => void;
  /** Tells the system-wide key handler which key is the Hodey key. */
  applyHodeyKey?: (key: Settings["hodeyKey"]) => void;
}

/** A typed goal as an event: its task pack, or (when vision can plan) the app it names. */
export function goalEvent(goal: string, packs: TaskPack[], openAllowed: boolean, mode?: HodeMode): HodeEvent {
  return { type: "GOAL_SUBMITTED", goal, pack: matchGoal(goal, packs), openAllowed, app: appFromGoal(goal), mode };
}

/** Starts a Hode the app asked for, ending whatever is running first. */
export function startFromApp(runtime: HodeRuntime, goal: string, packs: TaskPack[], openAllowed: boolean): void {
  if (runtime.getState().phase !== "idle") runtime.dispatch({ type: "END_HODE" });
  runtime.dispatch({ type: "START_HODE" });
  runtime.dispatch(goalEvent(goal, packs, openAllowed));
}

function applySettings(deps: BridgeDeps, settings: Settings): void {
  deps.runtime.configure({ mode: settings.mode, stuckMs: settings.stuckSeconds * MS_PER_SECOND });
  deps.runtime.setMuted(!settings.voice.enabled);
  deps.applyVoice(settings.voice);
  deps.applyHodeyKey?.(settings.hodeyKey);
}

function loadSettings(deps: BridgeDeps): void {
  deps.settings.load().then(
    (settings) => applySettings(deps, settings),
    (error) => console.error("Couldn't load Hodey's settings; using defaults", error),
  );
}

/**
 * Connects the runtime in the notch to everything else: learning history, the app window's
 * commands and live status, and settings. Returns a disposer.
 */
export function connectHodeBridge(deps: BridgeDeps): () => void {
  const { runtime, bus } = deps;
  const recorder = new HodeRecorder(deps.log, () => bus.emit("data:changed", {}));
  let last = "";
  const broadcast = () => {
    const summary = summaryOf(runtime.getState());
    const key = JSON.stringify(summary);
    if (key !== last) bus.emit("hode:summary", summary);
    last = key;
  };
  loadSettings(deps);
  const offs = [
    runtime.onTransition(recorder.observe),
    runtime.subscribe(broadcast),
    bus.on("hode:summary-request", () => bus.emit("hode:summary", summaryOf(runtime.getState()))),
    bus.on("hode:start", ({ goal }) => startFromApp(runtime, goal, deps.packs, deps.openGoalsAllowed())),
    bus.on("hode:end", () => runtime.dispatch({ type: "END_HODE" })),
    bus.on("settings:changed", () => loadSettings(deps)),
  ];
  return () => offs.forEach((off) => off());
}
