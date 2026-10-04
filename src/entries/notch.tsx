import type { HindiScript } from "../data/settings";
import { asrLanguage } from "../lib/language";
import { invoke } from "@tauri-apps/api/core";
import { ActivityTracker, mirrorRemoteActivity, withScreenActivity } from "../lib/activity";
import { connectAppearance } from "../lib/appearance";
import { hodeyKeySetting } from "../lib/keys";
import { COPY } from "../lib/copy";
import { createLocalVoice, showMicDot, showStandbyDot } from "../providers/speech/local-voice";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { Notch } from "../components/notch/Notch";
import { connectHodeBridge } from "../features/hode/bridge";
import { connectVoice, withoutEcho } from "../features/voice/connect";
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
  /** Talk back and forth (Settings > Voice); updated when settings load or change. */
  let conversation = true;
  let wakeWords: string[] = [];
  let script: HindiScript = "devanagari";
  const voice = createLocalVoice({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  showMicDot(voice.speech, activity);
  showStandbyDot(voice.status, activity);
  const runtime = new HodeRuntime({ perception, reasoners: [local], skills: learning, bus, tts: voice.tts });
  runtime.subscribe(() => native.setWatching(WATCHING_PHASES.includes(runtime.getState().phase)));
  connectHodeBridge({
    runtime,
    bus,
    log: learning,
    settings,
    packs: TASK_PACKS,
    openGoalsAllowed: () => vision.current().state === "ready",
    applyVoice: (settings) => {
      voice.apply(settings);
      conversation = settings.conversation;
      wakeWords = settings.wakeWords;
      script = settings.hindiScript;
      invoke<void>("set_speech_language", { language: asrLanguage(settings.language) }).catch((error) => console.error("Couldn't set the speech language", error));
      voice.speech.setHandsFree(settings.handsFree, settings.wakeWords).catch((error) => console.error("Couldn't switch hands-free listening", error));
    },
    applyHodeyKey: (key) => {
      hodeyKeySetting.set(key);
      invoke<void>("set_hodey_key", { key }).catch((error) => console.error("Couldn't set the Hodey key", error));
    },
  });
  connectVoice({
    speech: voice.speech,
    getState: () => runtime.getState(),
    dispatch: runtime.dispatch,
    interrupt: () => runtime.interruptSpeech(),
    hodeySaying: () => runtime.hodeySaying(),
    onHodeyDoneSpeaking: (listener) => runtime.onSpeechFinished(listener),
    conversation: () => conversation,
    wakeWords: () => wakeWords,
    heard: (text) => runtime.noticeLanguage(text),
    packs: TASK_PACKS,
    openAllowed: () => vision.current().state === "ready",
  });
  mount(<Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} vision={vision} activity={activity} speech={withoutEcho(voice.speech, () => runtime.hodeySaying())} script={() => script} />);
}

boot().catch((error) => console.error("Hodey failed to start", error));
