import { invoke } from "@tauri-apps/api/core";
import { ActivityTracker, withScreenActivity } from "../lib/activity";
import { COPY } from "../lib/copy";
import { UnavailableSpeechInput } from "../providers/speech/speech-input";
import { TauriBus, subscribeTauri } from "../lib/tauri-bus";
import { TauriShell } from "../lib/tauri-shell";
import { Notch } from "../components/notch/Notch";
import type { HodePhase } from "../features/hode/model";
import { HodeRuntime } from "../features/hode/runtime";
import type { SkillStore } from "../providers/interfaces";
import { MemorySkillStore } from "../providers/memory-skill-store";
import { NativePerception } from "../providers/native-perception";
import { SqliteSkillStore } from "../providers/sqlite-skill-store";
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

async function openSkills(): Promise<{ skills: SkillStore; notice?: string }> {
  try {
    return { skills: await SqliteSkillStore.open() };
  } catch (error) {
    console.error("Opening the skill database failed; progress is kept in memory for this session", error);
    return { skills: new MemorySkillStore(), notice: COPY.progressNotSaved };
  }
}

async function boot(): Promise<void> {
  const bus = new TauriBus();
  const { skills, notice } = await openSkills();
  const activity = new ActivityTracker();
  const native = new NativePerception({ invoke, listen: (event, handler) => subscribeTauri(event, handler) });
  const perception = withScreenActivity(native, activity);
  const vision = new TauriVisionStatus();
  const qwen = new QwenVisionProvider({
    connection: () => connectionOf(vision.current()),
    capture: () => activity.track("screen", () => invoke<CapturedFrame>("capture_active_window")),
  });
  const local = new LocalReasoningProvider(new TaskPackReasoningProvider(), qwen, () => vision.current().state === "ready");
  const runtime = new HodeRuntime({
    perception,
    reasoners: [local],
    skills,
    bus,
    tts: new WebSpeechTTSProvider(),
  });
  runtime.subscribe(() => native.setWatching(WATCHING_PHASES.includes(runtime.getState().phase)));
  mount(<Notch runtime={runtime} bus={bus} shell={new TauriShell()} packs={TASK_PACKS} bootNotice={notice} vision={vision} activity={activity} speech={new UnavailableSpeechInput()} />);
}

boot().catch((error) => console.error("Hodey failed to start", error));
