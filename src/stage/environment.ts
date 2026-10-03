import { ActivityTracker, withScreenActivity } from "../lib/activity";
import { connectAppearance } from "../lib/appearance";
import { LocalBus } from "../lib/bus";
import { BrowserShell } from "../lib/shell";
import { connectHodeBridge } from "../features/hode/bridge";
import { HodeRuntime } from "../features/hode/runtime";
import { MemoryChatStore, MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore } from "../data/settings";
import type { AppServices } from "../app/services";
import { MockPerception, type MockApp } from "../providers/mock-perception";
import { UnavailableSpeechInput, type SpeechInput } from "../providers/speech/speech-input";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { WebSpeechTTSProvider } from "../providers/web-speech-tts";
import { TASK_PACKS } from "../task-packs";
import { ExcelScene } from "./scenes/excel";
import { ExplorerScene } from "./scenes/explorer";

export type StageAppId = "excel" | "explorer";

/** About what a UI Automation read plus reasoning takes on the real desktop. */
const STAGE_LOOK_MS = 650;
const STAGE_LIMITATION = "Chat uses the local vision model, which runs in the Hodeum desktop app. The practice stage has no model.";

export interface StageEnvironment {
  apps: { excel: ExcelScene; explorer: ExplorerScene };
  bus: LocalBus;
  shell: BrowserShell;
  perception: MockPerception;
  runtime: HodeRuntime;
  activity: ActivityTracker;
  speech: SpeechInput;
  /** Services for the in-page Hodeum app; `window.close` is replaced by the stage. */
  appServices: (close: () => void) => AppServices;
  select(id: StageAppId): void;
}

/** Wires the real runtime, history, and app to scripted practice apps, all inside one browser page. */
export function createStageEnvironment(): StageEnvironment {
  const apps = { excel: new ExcelScene(), explorer: new ExplorerScene() };
  let current: MockApp = apps.excel;
  const bus = new LocalBus();
  const perception = new MockPerception(() => current, STAGE_LOOK_MS);
  const activity = new ActivityTracker();
  const learning = new MemoryLearningStore();
  const settings = new MemorySettingsStore();
  const chats = new MemoryChatStore();
  const tts = new WebSpeechTTSProvider();
  const runtime = new HodeRuntime({ perception: withScreenActivity(perception, activity), reasoners: [new TaskPackReasoningProvider()], skills: learning, bus, tts });
  connectHodeBridge({ runtime, bus, log: learning, settings, packs: TASK_PACKS, openGoalsAllowed: () => false, applyVoice: (voice) => {
      tts.rate = voice.rate;
      tts.voiceName = voice.name;
    } });
  connectAppearance(settings, bus, document.documentElement);
  return {
    apps,
    bus,
    shell: new BrowserShell(),
    perception,
    runtime,
    activity,
    speech: new UnavailableSpeechInput(),
    appServices: (close) => ({
      learning,
      chats,
      settings,
      bus,
      packs: TASK_PACKS,
      window: { minimize: close, toggleMaximize: () => undefined, close },
      limitation: STAGE_LIMITATION,
    }),
    select(id) {
      current = apps[id];
    },
  };
}
