import { invoke } from "@tauri-apps/api/core";
import { ActivityTracker, mirrorRemoteActivity, withScreenActivity } from "../lib/activity";
import { connectAppearance } from "../lib/appearance";
import { COPY } from "../lib/copy";
import { UnavailableSpeechInput } from "../providers/speech/speech-input";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { Notch } from "../components/notch/Notch";
import { connectHodeBridge } from "../features/hode/bridge";
import type { HodePhase } from "../features/hode/model";
import { HodeRuntime } from "../features/hode/runtime";
import { MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore, type SettingsStore } from "../data/settings";
import { openDatabase } from "../data/sql";
import { SqliteLearningStore, SqliteSettingsStore } from "../data/sqlite-stores";
import { NativePerception } from "../providers/native-perception";
import { LocalReasoningProvider } from "../providers/local-reasoner";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { QwenVisionProvider } from "../providers/vision/qwen-vision-provider";
import { TauriVisionStatus } from "../providers/vision/tauri-vision-status";
import { connectionOf, type CapturedFrame } from "../providers/vision/types";
import { WebSpeechTTSProvider } from "../providers/web-speech-tts";
import { TASK_PACKS } from "../task-packs";
import { mount } from "./mount";

/** Learner input is only worth re-reading the screen for while guidance waits on the learner. */
const WATCHING_PHASES: HodePhase[] = ["guiding", "reasoning"];

interface Stores {
  learning: SqliteLearningStore | MemoryLearningStore;
  settings: SettingsStore;
  notice?: string;
}

async function openStores(): Promise<Stores> {
  try {
    const db = await openDatabase();
    return { learning: new SqliteLearningStore(db), settings: new SqliteSettingsStore(db) };
  } catch (error) {
    console.error("Opening the Hodeum database failed; progress is kept in memory for this session", error);
    return { learning: new MemoryLearningStore(), settings: new MemorySettingsStore(), notice: COPY.progressNotSaved };
  }
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const { learning, settings, notice } = await openStores();
  const activity = new ActivityTracker();
  mirrorRemoteActivity(bus, activity);
  connectAppearance(settings, bus, document.documentElement);
  const native = new NativePerception({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  const perception = withScreenActivity(native, activity);
  const vision = new TauriVisionStatus();
  const qwen = new QwenVisionProvider({
    connection: () => connectionOf(vision.current()),
    capture: () => activity.track("screen", () => invoke<CapturedFrame>("capture_active_window")),
  });
  const local = new LocalReasoningProvider(new TaskPackReasoningProvider(), qwen, () => vision.current().state === "ready");
  const tts = new WebSpeechTTSProvider();
  const runtime = new HodeRuntime({ perception, reasoners: [local], skills: learning, bus, tts });
  runtime.subscribe(() => native.setWatching(WATCHING_PHASES.includes(runtime.getState().phase)));
  connectHodeBridge({
    runtime,
    bus,
    log: learning,
    settings,
    packs: TASK_PACKS,
    openGoalsAllowed: () => vision.current().state === "ready",
    applyVoice: (voice) => {
      tts.rate = voice.rate;
      tts.voiceName = voice.name;
    },
  });
  mount(<Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} vision={vision} activity={activity} speech={new UnavailableSpeechInput()} />);
}

boot().catch((error) => console.error("Hodey failed to start", error));
