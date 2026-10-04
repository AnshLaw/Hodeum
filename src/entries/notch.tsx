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
import { connectAccount } from "../features/account/connect";
import { CloudContext } from "../components/notch/cloud-context";
import { connectCloud } from "../providers/cloud/connect";
import { CloudFirstTTS, ElevenLabsTTSProvider } from "../providers/cloud/elevenlabs-tts";
import { lessonSpeech } from "../providers/cloud/shareable";
import { GatedReasoner } from "../providers/cloud/gated";
import { GeminiReasoningProvider } from "../providers/cloud/gemini-reasoner";
import { connectHodeBridge } from "../features/hode/bridge";
import { connectVoice, withoutEcho } from "../features/voice/connect";
import type { HodePhase } from "../features/hode/model";
import { HodeRuntime } from "../features/hode/runtime";
import { MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore, type SettingsStore } from "../data/settings";
import { openDatabase } from "../data/sql";
import { SqliteLearningStore, SqliteSettingsStore } from "../data/sqlite-stores";
import { NativePerception } from "../providers/native-perception";
import { SurfacePerception } from "../providers/surface-perception";
import { AirPlayPhoneSource } from "../features/phone/airplay-source";
import { CameraPhoneSource } from "../features/phone/camera-source";
import { FrameCanvas } from "../features/phone/frame-canvas";
import { PhoneMirror } from "../features/phone/phone-mirror";
import { PhonePerception, type OcrSegment } from "../features/phone/phone-perception";
import { loadPhonePrefs } from "../features/phone/prefs";
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

/**
 * Perception for both surfaces: UI Automation on the desktop, OCR on the mirrored iPhone. The running
 * Hode's pack picks one; screen captures for the vision model follow the same choice.
 */
function createPerception(activity: ActivityTracker) {
  const native = new NativePerception({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  const mirror = new PhoneMirror(new FrameCanvas(), (kind) =>
    kind === "camera" ? new CameraPhoneSource(() => loadPhonePrefs().cameraLabel) : new AirPlayPhoneSource(invoke),
  );
  const phone = new PhonePerception(mirror, (png) => invoke<OcrSegment[]>("ocr_frame", { png }));
  const surfaces = new SurfacePerception({ windows: native, phone });
  const capture = () => activity.track("screen", () => (surfaces.current() === "phone" ? mirror.grabFrame() : invoke<CapturedFrame>("capture_active_window")));
  return { mirror, surfaces, perception: withScreenActivity(surfaces, activity), capture };
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const { learning, settings, notice } = await openStores();
  const activity = new ActivityTracker();
  mirrorRemoteActivity(bus, activity);
  connectAppearance(settings, bus, document.documentElement);
  const { mirror, surfaces, perception, capture } = createPerception(activity);
  const vision = new TauriVisionStatus();
  const qwen = new QwenVisionProvider({ connection: () => connectionOf(vision.current()), capture });
  const local = new LocalReasoningProvider(new TaskPackReasoningProvider(), qwen, () => vision.current().state === "ready");
  /** Talk back and forth (Settings > Voice); updated when settings load or change. */
  let conversation = true;
  let wakeWords: string[] = [];
  let script: HindiScript = "devanagari";
  const voice = createLocalVoice({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  showMicDot(voice.speech, activity);
  showStandbyDot(voice.status, activity);
  const cloud = connectCloud({ invoke, bus, activeApp: () => runtime.getState().observation });
  // Gemini only when opted in and allowed for this app; local always answers last.
  const gemini = new GatedReasoner(new GeminiReasoningProvider({ invoke }), "gemini", cloud.policy, activity);
  // ElevenLabs first when Settings > Cloud allows it right now; the local voice says anything it skips or fails.
  const elevenlabs = new ElevenLabsTTSProvider(invoke);
  const tts = new CloudFirstTTS({ cloud: elevenlabs, local: voice.tts, policy: cloud.policy, activity, shareable: (): boolean => lessonSpeech(runtime.getState()) });
  const runtime = new HodeRuntime({ perception, reasoners: [gemini, local], skills: learning, bus, tts });
  // Runs before the transition's effects, so a phone Hode's first focusApp/observe already reach the phone.
  runtime.subscribe(() => {
    const state = runtime.getState();
    surfaces.setSurface(state.pack?.surface ?? "windows");
    surfaces.setWatching(WATCHING_PHASES.includes(state.phase));
    cloud.appChanged();
  });
  connectHodeBridge({
    runtime,
    bus,
    log: learning,
    settings,
    packs: TASK_PACKS,
    openGoalsAllowed: () => vision.current().state === "ready",
    applyVoice: (settings) => {
      voice.apply(settings);
      elevenlabs.rate = settings.rate;
      conversation = settings.conversation;
      wakeWords = settings.wakeWords;
      script = settings.hindiScript;
      invoke<void>("set_speech_language", { language: asrLanguage(settings.language) }).catch((error) => console.error("Couldn't set the speech language", error));
      voice.speech.setHandsFree(settings.handsFree, settings.wakeWords).catch((error) => console.error("Couldn't switch hands-free listening", error));
    },
    applyCloud: (settings) => cloud.apply(settings),
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
  connectAccount({ bus, settings, activity, invoke, listen: (event, handler) => subscribeTauri(event, handler) }).catch((error) => console.error("Accounts didn't start; Hodeum stays local", error));
  mount(
    <CloudContext.Provider value={cloud.policy}>
      <Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} vision={vision} activity={activity} speech={withoutEcho(voice.speech, () => runtime.hodeySaying())} script={() => script} phone={mirror} />
    </CloudContext.Provider>,
  );
}

boot().catch((error) => console.error("Hodey failed to start", error));
