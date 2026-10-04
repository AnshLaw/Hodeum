import { ActivityTracker, withScreenActivity } from "../lib/activity";
import { connectAppearance } from "../lib/appearance";
import { LocalBus } from "../lib/bus";
import { BrowserShell } from "../lib/shell";
import { connectHodeBridge } from "../features/hode/bridge";
import { HodeRuntime } from "../features/hode/runtime";
import { MemoryChatStore, MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore } from "../data/settings";
import type { AppServices } from "../app/services";
import { LocalMemoryProvider } from "../providers/memory/sqlite-memory";
import { MockPerception, type MockApp } from "../providers/mock-perception";
import { UnavailableSpeechInput, type SpeechInput } from "../providers/speech/speech-input";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { WebSpeechTTSProvider } from "../providers/web-speech-tts";
import { TASK_PACKS } from "../task-packs";
import { ExcelScene } from "./scenes/excel";
import { ExplorerScene } from "./scenes/explorer";
import { PracticeCloudCatalog, PracticeCloudKeys } from "./practice-cloud-keys";
import { IphoneScene } from "./scenes/iphone";
import { FrameCanvas } from "../features/phone/frame-canvas";
import { PhoneMirror } from "../features/phone/phone-mirror";
import { StagePhoneSource, stageFrameRect } from "./stage-phone";

export type StageAppId = "excel" | "explorer" | "iphone";

/** About what a UI Automation read plus reasoning takes on the real desktop. */
const STAGE_LOOK_MS = 650;
const STAGE_LIMITATION = "Chat uses the local vision model, which runs in the Hodeum desktop app. The practice stage has no model.";

export interface StageEnvironment {
  apps: { excel: ExcelScene; explorer: ExplorerScene; iphone: IphoneScene };
  bus: LocalBus;
  shell: BrowserShell;
  perception: MockPerception;
  runtime: HodeRuntime;
  activity: ActivityTracker;
  speech: SpeechInput;
  /** The skill store the runtime saves to; the notch reads its skill graph from it. */
  learning: MemoryLearningStore;
  /** "Show iPhone" in the notch mirrors the practice iPhone, so the enlarged notch can be rehearsed. */
  phone: PhoneMirror;
  /** Services for the in-page Hodeum app; `window.close` is replaced by the stage. */
  appServices: (close: () => void) => AppServices;
  select(id: StageAppId): void;
}

/** Wires the real runtime, history, and app to scripted practice apps, all inside one browser page. */
export function createStageEnvironment(): StageEnvironment {
  const apps = { excel: new ExcelScene(), explorer: new ExplorerScene(), iphone: new IphoneScene() };
  let current: MockApp = apps.excel;
  const bus = new LocalBus();
  const perception = new MockPerception(() => current, STAGE_LOOK_MS);
  const activity = new ActivityTracker();
  const learning = new MemoryLearningStore();
  const settings = new MemorySettingsStore();
  const chats = new MemoryChatStore();
  const cloudKeys = new PracticeCloudKeys();
  const cloudCatalog = new PracticeCloudCatalog(cloudKeys);
  const tts = new WebSpeechTTSProvider();
  const memory = new LocalMemoryProvider();
  const runtime = new HodeRuntime({ perception: withScreenActivity(perception, activity), reasoners: [new TaskPackReasoningProvider()], skills: learning, bus, tts, memory });
  connectHodeBridge({ runtime, bus, log: learning, settings, packs: TASK_PACKS, openGoalsAllowed: () => false, memory, applyVoice: (voice) => {
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
    learning,
    phone: new PhoneMirror(new FrameCanvas(), () => new StagePhoneSource(apps.iphone), stageFrameRect),
    appServices: (close) => ({
      learning,
      chats,
      settings,
      bus,
      packs: TASK_PACKS,
      cloudKeys,
      cloudCatalog,
      window: { minimize: close, toggleMaximize: () => undefined, close },
      limitation: STAGE_LIMITATION,
    }),
    select(id) {
      current = apps[id];
    },
  };
}
