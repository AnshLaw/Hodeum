import { replyLanguage } from "../../lib/language";
import type { Bus, BusEvents, HodeSummary } from "../../lib/bus";
import type { AgentStyle, HodeMode, InstalledApp, TaskPack } from "../../lib/types";
import { HodeRecorder } from "../../data/recorder";
import type { Settings, SettingsStore } from "../../data/settings";
import type { HodeLog } from "../../data/types";
import { appFromGoal, matchGoal } from "../../task-packs/match";
import type { MemoryProvider } from "../../providers/interfaces";
import { appNamedIn } from "../apps/resolve";
import { HodeMemoryTracker } from "../memory/tracker";
import { classify } from "../voice/intent";
import { openAppEvent } from "./open-app";
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
  /** Whether the local vision model is still loading, so a goal it can't plan yet says so. */
  visionStarting?: () => boolean;
  /** The installed apps, for "open Excel" goals; empty until the catalog loads. Never offered to a web goal. */
  apps?: () => InstalledApp[];
  /** Applies speech settings to the voice in use. */
  applyVoice: (voice: Settings["voice"]) => void;
  /** Tells the system-wide key handler which key is the Hodey key. */
  applyHodeyKey?: (key: Settings["hodeyKey"]) => void;
  /** Tells the cloud policy which cloud providers are turned on. */
  applyCloud?: (cloud: Settings["cloud"]) => void;
  /** Whether a spoken question may be looked up on the web (the offline help is used either way). */
  applyWebSearch?: (enabled: boolean) => void;
  /** Learning memory: a compact summary is stored when each Hode completes or is ended. */
  memory?: Pick<MemoryProvider, "storeLearningSummary">;
}

export interface GoalOptions {
  packs: TaskPack[];
  openAllowed: boolean;
  /** The installed apps (`list_apps`), for goals about an app Hodeum doesn't know by name ("…on Discord"). */
  apps?: InstalledApp[];
  mode?: HodeMode;
  agentStyle?: AgentStyle;
  visionStarting?: boolean;
  /** The iPhone mirror is live: a goal that names no desktop app is about the iPhone. Defaults to the mirror's own state. */
  phoneLive?: boolean;
}

let phoneLiveNow: () => boolean = () => false;
/** Lets every goal path (typed, spoken, app) know whether the iPhone mirror is live. */
export function watchPhoneLive(isLive: () => boolean): void {
  phoneLiveNow = isLive;
}

/** Words that keep a goal on the PC even with the iPhone mirrored ("switch windows to light mode"). */
const PC_WORDS = /\b(?:windows|pc|laptop|computer|desktop)\b/i;

/** With the iPhone on screen, "turn on dark mode" means the iPhone's, not Windows'. */
function phonePack(goal: string, packs: TaskPack[]): TaskPack | undefined {
  if (PC_WORDS.test(goal)) return undefined;
  return matchGoal(`${goal} iphone`, packs.filter((pack) => pack.surface === "phone"));
}

const sameApp = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * A typed goal as an event: its task pack, or (when vision can plan) the app it names, built in or installed.
 * Only a built-in app keeps a pack from the goal (`matchGoal`): an installed app it mentions is often just where
 * the result goes ("save a note to OneDrive"), so it never replaces the lesson.
 */
export function goalEvent(goal: string, { packs, openAllowed, apps = [], mode, agentStyle, visionStarting, phoneLive = phoneLiveNow() }: GoalOptions): HodeEvent {
  const named = appFromGoal(goal);
  const installed = named === undefined ? appNamedIn(goal, apps) : undefined;
  // A goal that names a desktop app stays on the PC, even with the iPhone mirrored.
  const onPhone = phoneLive && named === undefined && installed === undefined ? phonePack(goal, packs) : undefined;
  const matched = onPhone ?? matchGoal(goal, packs);
  const pack = matched && (onPhone !== undefined || named === undefined || sameApp(matched.app, named)) ? matched : undefined;
  // A lesson wins over an installed app the goal only mentions ("…to send on WhatsApp"); those name the app of a goal with none.
  const app = named ?? (pack ? undefined : installed);
  const starting = !openAllowed && visionStarting === true ? { visionStarting: true } : {};
  return { type: "GOAL_SUBMITTED", goal, pack, openAllowed, app, mode, agentStyle, ...starting };
}

/**
 * A goal typed or said into the goal form, as events: an app to open ("open Excel"), the goal (a pack's, a task,
 * or a question to take as one), or a nudge to name a task when it's a greeting, noise or unclear.
 */
export function goalEvents(text: string, options: GoalOptions): HodeEvent[] {
  const open = openAppEvent(text, options.apps ?? []);
  if (open) return [{ ...open, ...(options.mode ? { mode: options.mode } : {}) }];
  const goal = goalEvent(text, options);
  if (goal.type === "GOAL_SUBMITTED" && goal.pack) return [goal];
  const intent = classify(text);
  if (intent === "greeting") return [{ type: "CHITCHAT", kind: "greeting" }];
  if (intent === "noise" || intent === "ack" || intent === "unclear") return [{ type: "CHITCHAT", kind: "unclear" }];
  return [goal];
}

/**
 * Starts a Hode the app asked for (or the debug hook), ending whatever is running first. An app request opens
 * the app instead, and small talk gets a reply, leaving a running Hode alone.
 */
export function startFromApp(runtime: HodeRuntime, goal: string, packs: TaskPack[], openAllowed: boolean, options: Omit<GoalOptions, "packs" | "openAllowed"> = {}): void {
  const events = goalEvents(goal, { packs, openAllowed, ...options });
  if (events[0]?.type !== "GOAL_SUBMITTED") {
    events.forEach(runtime.dispatch);
    return;
  }
  if (runtime.getState().phase !== "idle") runtime.dispatch({ type: "END_HODE" });
  runtime.dispatch({ type: "START_HODE" });
  events.forEach(runtime.dispatch);
}

function applySettings(deps: BridgeDeps, settings: Settings): void {
  deps.runtime.configure({ mode: settings.mode, agentStyle: settings.agentStyle, stuckMs: settings.stuckSeconds * MS_PER_SECOND, language: replyLanguage(settings.voice.language) });
  deps.runtime.setMuted(!settings.voice.enabled);
  deps.applyVoice(settings.voice);
  deps.applyHodeyKey?.(settings.hodeyKey);
  deps.applyCloud?.(settings.cloud);
  deps.applyWebSearch?.(settings.webSearch);
}

/**
 * The apps a goal may open: none for one sent from the web dashboard, so whoever holds the learner's web
 * session can start a Hode on this PC but can't open a program (Command Prompt, PowerShell) with it.
 */
function appsFor(deps: BridgeDeps, source: BusEvents["hode:start"]["source"]): InstalledApp[] {
  return source === "web" ? [] : (deps.apps?.() ?? []);
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
  const memory = deps.memory ? new HodeMemoryTracker(deps.memory) : undefined;
  const offs = [
    runtime.onTransition(recorder.observe),
    ...(memory ? [runtime.onTransition(memory.observe)] : []),
    runtime.subscribe(broadcast),
    bus.on("hode:summary-request", () => bus.emit("hode:summary", summaryOf(runtime.getState()))),
    bus.on("hode:start", ({ goal, mode, agentStyle, source }) =>
      startFromApp(runtime, goal, deps.packs, deps.openGoalsAllowed(), { apps: appsFor(deps, source), mode, agentStyle, visionStarting: deps.visionStarting?.() }),
    ),
    bus.on("hode:end", () => runtime.dispatch({ type: "END_HODE" })),
    bus.on("settings:changed", () => loadSettings(deps)),
  ];
  return () => offs.forEach((off) => off());
}
