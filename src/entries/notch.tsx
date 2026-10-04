// First, so component styles of equal specificity win in dev as they do in release builds.
import "../components/shared/base.css";
import type { HindiScript } from "../data/settings";
import { asrLanguage } from "../lib/language";
import { TauriVoiceHardware, applyVoiceHardware, type VoiceSetup } from "../features/voice/hardware";
import { invoke } from "@tauri-apps/api/core";
import { ActivityTracker, mirrorRemoteActivity, screenWatch, withScreenActivity } from "../lib/activity";
import { connectAppearance } from "../lib/appearance";
import { hodeyKeySetting } from "../lib/keys";
import { COPY } from "../lib/copy";
import { createLocalVoice, showMicDot, showStandbyDot } from "../providers/speech/local-voice";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { Notch } from "../components/notch/Notch";
import { connectAccount } from "../features/account/connect";
import { CloudContext } from "../components/notch/cloud-context";
import type { CloudSetup } from "../components/notch/CloudMenu";
import { TauriCloudCatalog } from "../providers/cloud/catalog";
import { connectCloud } from "../providers/cloud/connect";
import { CloudFirstTTS, ElevenLabsTTSProvider } from "../providers/cloud/elevenlabs-tts";
import { lessonCorpus, shareableText } from "../providers/cloud/shareable";
import { GatedReasoner } from "../providers/cloud/gated";
import { GeminiReasoningProvider } from "../providers/cloud/gemini-reasoner";
import { connectHodeBridge } from "../features/hode/bridge";
import { connectVoice, withoutEcho } from "../features/voice/connect";
import type { HodePhase } from "../features/hode/model";
import { HodeRuntime } from "../features/hode/runtime";
import { MemoryLearningStore } from "../data/memory-stores";
import { MemorySettingsStore, type SettingsStore } from "../data/settings";
import { openDatabase } from "../data/sql";
import { SqliteKeyValueStore, SqliteLearningStore, SqliteSettingsStore } from "../data/sqlite-stores";
import { MemoryKeyValueStore, type KeyValueStore } from "../data/kv";
import type { MemoryProvider } from "../providers/interfaces";
import { BackboardMemoryProvider } from "../providers/memory/backboard-memory";
import { RoutedMemory } from "../providers/memory/routed-memory";
import { LocalMemoryProvider, SqliteMemoryProvider } from "../providers/memory/sqlite-memory";
import { NativePerception } from "../providers/native-perception";
import { SurfacePerception } from "../providers/surface-perception";
import { AirPlayPhoneSource } from "../features/phone/airplay-source";
import { CameraPhoneSource } from "../features/phone/camera-source";
import { FrameCanvas } from "../features/phone/frame-canvas";
import { PhoneMirror } from "../features/phone/phone-mirror";
import { PhonePerception, type OcrSegment } from "../features/phone/phone-perception";
import { loadPhonePrefs } from "../features/phone/prefs";
import { GroundedPlannerProvider, LocalReasoningProvider } from "../providers/local-reasoner";
import { TaskPackReasoningProvider } from "../providers/task-pack-reasoner";
import { QwenVisionProvider } from "../providers/vision/qwen-vision-provider";
import { TauriVisionStatus } from "../providers/vision/tauri-vision-status";
import { connectionOf, type CapturedFrame } from "../providers/vision/types";
import { createHowToLookup } from "../providers/web/lookup";
import { spokenReference } from "../providers/web/reference";
import { TauriWebSearch } from "../app/tauri-services";
import { TASK_PACKS } from "../task-packs";
import type { InstalledApp, TaskPack } from "../lib/types";
import type { DebugDeps } from "../features/debug/automation";
import { mount } from "./mount";

/** Learner input is only worth re-reading the screen for while guidance waits on the learner. */
/** Clicks are watched while a step is being prepared too, so a learner who's quicker than Hodey still counts. */
const WATCHING_PHASES: HodePhase[] = ["guiding", "reasoning", "observing"];

interface Stores {
  learning: SqliteLearningStore | MemoryLearningStore;
  settings: SettingsStore;
  /** Local learning memory (end-of-Hode summaries) and small local values such as the Backboard assistant id. */
  memory: MemoryProvider;
  kv: KeyValueStore;
  notice?: string;
}

async function openStores(): Promise<Stores> {
  try {
    const db = await openDatabase();
    return { learning: new SqliteLearningStore(db), settings: new SqliteSettingsStore(db), memory: new SqliteMemoryProvider(db), kv: new SqliteKeyValueStore(db) };
  } catch (error) {
    console.error("Opening the Hodeum database failed; progress is kept in memory for this session", error);
    return { learning: new MemoryLearningStore(), settings: new MemorySettingsStore(), memory: new LocalMemoryProvider(), kv: new MemoryKeyValueStore(), notice: COPY.progressNotSaved };
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
  const capture = (windowId?: number) =>
    activity.track("screen", () => (surfaces.current() === "phone" ? mirror.grabFrame() : invoke<CapturedFrame>("capture_active_window", { windowId: windowId ?? null })));
  return { mirror, surfaces, perception: withScreenActivity(surfaces, activity), capture };
}

/** The GPU listener's second pass spells these right; Whisper's prompt is short, so only the first few. */
const MAX_SPEECH_HINTS = 24;

/** Words the learner is likely to say during a lesson: its app and the controls its steps name. */
function lessonHints(pack: TaskPack | undefined): string[] {
  if (!pack) return [];
  const names = pack.steps.flatMap((step) => step.target.names).filter((name) => !name.includes("*"));
  return [...new Set([pack.app, ...names])].slice(0, MAX_SPEECH_HINTS);
}

/** The installed apps, listed once at startup for "open Excel"; until then (or if listing fails) app requests are ordinary goals. */
function loadInstalledApps(): () => InstalledApp[] {
  let apps: InstalledApp[] = [];
  invoke<InstalledApp[]>("list_apps").then(
    (listed) => {
      apps = listed;
    },
    (error: unknown) => console.error(`Couldn't list the installed apps; "open <app>" won't open anything this session`, error),
  );
  return () => apps;
}

/** DEV builds only: `window.__hodeumDebug` for the test harness. The dynamic import keeps it out of release bundles. */
function installDebug(deps: Omit<DebugDeps, "quit">): void {
  if (import.meta.env.DEV) {
    import("../features/debug/automation").then(
      ({ installDebugHook }) => installDebugHook({ ...deps, quit: () => invoke<void>("debug_quit") }),
      (error: unknown) => console.error("Couldn't install the debug hook", error),
    );
  }
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const { learning, settings, memory: localMemory, kv, notice } = await openStores();
  // No Hode runs yet: any left open by a quit or crash is over, so it stops showing "in progress" (here and on the web).
  await learning.closeOpenHodes().catch((error: unknown) => console.error("Couldn't close Hodes left open last time", error));
  const activity = new ActivityTracker();
  mirrorRemoteActivity(bus, activity);
  connectAppearance(settings, bus, document.documentElement);
  const { mirror, surfaces, perception, capture } = createPerception(activity);
  const vision = new TauriVisionStatus();
  const qwen = new QwenVisionProvider({ connection: () => connectionOf(vision.current()), capture });
  const planner = new TaskPackReasoningProvider();
  const local = new LocalReasoningProvider(planner, qwen, () => vision.current().state === "ready");
  /** Talk back and forth (Settings > Voice); updated when settings load or change. */
  let conversation = true;
  let wakeWords: string[] = [];
  let script: HindiScript = "devanagari";
  const voice = createLocalVoice({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  showMicDot(voice.speech, activity);
  showStandbyDot(voice.status, activity);
  const cloud = connectCloud({ invoke, bus, activeApp: () => runtime.getState().observation });
  // Gemini only when opted in and allowed for this app; local always answers last.
  const geminiProvider = new GeminiReasoningProvider({ invoke });
  const gemini = new GatedReasoner(geminiProvider, "gemini", cloud.policy, activity);
  // ElevenLabs first when Settings > Cloud allows it right now; the local voice says anything it skips or fails.
  const elevenlabs = new ElevenLabsTTSProvider(invoke);
  const lessonLines = lessonCorpus(TASK_PACKS);
  const tts = new CloudFirstTTS({ cloud: elevenlabs, local: voice.tts, policy: cloud.policy, activity, shareable: (text) => shareableText(text, lessonLines) });
  // SQLite always; Backboard only while the cloud policy allows it (and writes only in "auto").
  const memory = new RoutedMemory(localMemory, new BackboardMemoryProvider({ invoke, policy: cloud.policy, kv }), () => cloud.policy.reportFailure("backboard"));
  // A lesson step UI Automation grounds is answered locally at once; the cloud and the vision model only take the rest.
  // A spoken question gets the offline help's steps, or one scrubbed web search when Settings allows it.
  let webAllowed = false;
  const howTo = createHowToLookup({ web: new TauriWebSearch(bus), webEnabled: () => webAllowed, onProgress: (progress) => bus.emit("web:search", progress) });
  const reference = spokenReference(howTo, (stop) => bus.on("web:cancel", stop));
  const runtime = new HodeRuntime({ perception, reasoners: [new GroundedPlannerProvider(planner), gemini, local], skills: learning, bus, tts, memory, reference });
  // Runs before the transition's effects, so a phone Hode's first focusApp/observe already reach the phone.
  const watchDot = screenWatch(activity);
  let hintedPack: string | undefined;
  runtime.subscribe(() => {
    const state = runtime.getState();
    if (state.pack?.id !== hintedPack) {
      hintedPack = state.pack?.id;
      voice.speech.setSpeechHints(lessonHints(state.pack)).catch((error) => console.error("Couldn't tell the GPU listener the lesson's words", error));
    }
    surfaces.setSurface(state.pack?.surface ?? "windows");
    // In another app while the Hode's app waits behind it: its clicks and keys aren't read.
    const watching = WATCHING_PHASES.includes(state.phase) && !runtime.isAway();
    surfaces.setWatching(watching);
    watchDot(watching);
    cloud.appChanged();
  });
  const apps = loadInstalledApps();
  const openGoalsAllowed = () => vision.current().state === "ready";
  const visionStarting = () => vision.current().state === "starting";
  const cloudSetup: CloudSetup = { catalog: new TauriCloudCatalog(invoke), keys: () => cloud.keys.current(), settings, changed: () => bus.emit("settings:changed", {}) };
  const voiceSetup: VoiceSetup = { hardware: new TauriVoiceHardware(invoke), settings, changed: () => bus.emit("settings:changed", {}) };
  connectHodeBridge({
    runtime,
    bus,
    log: learning,
    settings,
    memory,
    packs: TASK_PACKS,
    openGoalsAllowed,
    visionStarting,
    apps,
    applyVoice: (settings) => {
      voice.apply(settings);
      elevenlabs.rate = settings.rate;
      conversation = settings.conversation;
      wakeWords = settings.wakeWords;
      script = settings.hindiScript;
      invoke<void>("set_speech_language", { language: asrLanguage(settings.language) }).catch((error) => console.error("Couldn't set the speech language", error));
      applyVoiceHardware(invoke, settings).catch((error) => console.error("Couldn't switch Hodey's microphone, speaker or speech model", error));
      voice.speech.setHandsFree(settings.handsFree, settings.wakeWords).catch((error) => console.error("Couldn't switch hands-free listening", error));
    },
    applyCloud: (settings) => {
      cloud.apply(settings);
      geminiProvider.model = settings.geminiModel;
      elevenlabs.model = settings.elevenlabsModel;
      elevenlabs.voiceId = settings.elevenlabsVoice;
    },
    applyWebSearch: (enabled) => {
      webAllowed = enabled;
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
    onHodeEvent: (listener) => runtime.onTransition((event) => listener(event)),
    packs: TASK_PACKS,
    openAllowed: () => vision.current().state === "ready",
    visionStarting,
    apps,
  });
  installDebug({ runtime, bus, packs: TASK_PACKS, apps, openGoalsAllowed });
  connectAccount({ bus, settings, activity, invoke, listen: (event, handler) => subscribeTauri(event, handler) }).catch((error) => console.error("Accounts didn't start; Hodeum stays local", error));
  mount(
    <CloudContext.Provider value={cloud.policy}>
      <Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} voiceStatus={voice.status} vision={vision} activity={activity} speech={withoutEcho(voice.speech, () => runtime.hodeySaying())} script={() => script} phone={mirror} skills={learning} voiceSetup={voiceSetup} cloudSetup={cloudSetup} apps={apps} />
    </CloudContext.Provider>,
  );
}

boot().catch((error) => console.error("Hodey failed to start", error));
